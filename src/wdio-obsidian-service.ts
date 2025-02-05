import fsAsync from "fs/promises"
import path from "path"
import { SevereServiceError } from 'webdriverio'
import type { Capabilities, Options, Services } from '@wdio/types'
import logger from '@wdio/logger'
import { fileURLToPath } from "url"
import { ObsidianDownloader, setupConfigAndVault } from "./obsidianUtils.js"
import browserCommands from "./browserCommands.js"
import {
    ObsidianCapabilityOptions, ObsidianServiceOptions, OBSIDIAN_CAPABILITY_KEY,
    LocalPluginEntry, LocalPluginEntryWithId, LocalThemeEntry, LocalThemeEntryWithName,
} from "./types.js"
import _ from "lodash"

const log = logger("wdio-obsidian-service");

export class ObsidianLauncherService implements Services.ServiceInstance {
    private obsidianDownloader: ObsidianDownloader
    private readonly helperPluginPath: string

    constructor (
        public options: ObsidianServiceOptions,
        public capabilities: WebdriverIO.Capabilities,
        public config: Options.Testrunner
    ) {
        this.obsidianDownloader = new ObsidianDownloader({
            cacheDir: config.cacheDir,
            versionsUrl: options.versionsUrl,
            communityPluginsUrl: options.communityPluginsUrl,
            communityThemesUrl: options.communityThemesUrl,
        });
        this.helperPluginPath = path.resolve(path.join(fileURLToPath(import.meta.url), '../../optl-plugin'));
    }


    async onPrepare(config: Options.Testrunner, capabilities: Capabilities.TestrunnerCapabilities) {
        if (!Array.isArray(capabilities)) {
            capabilities = Object.values(capabilities as Capabilities.RequestedMultiremoteCapabilities).map(
                (multiremoteOption) => (multiremoteOption as Capabilities.WithRequestedCapabilities).capabilities,
            );
        }

        const obsidianCapabilities = capabilities.flatMap((cap) => {
            if (("browserName" in cap) && cap.browserName === "obsidian") {
                return [cap as WebdriverIO.Capabilities];
            } else {
                return [];
            }
        });

        try {
            for (const cap of obsidianCapabilities) {
                const obsidianOptions = cap[OBSIDIAN_CAPABILITY_KEY] ?? {};
    
                const vault = obsidianOptions.vault != undefined ? path.resolve(obsidianOptions.vault) : undefined;
    
                const { appVersionInfo, installerVersionInfo } = await this.obsidianDownloader.resolveVersions(
                    cap.browserVersion ?? "latest",
                    obsidianOptions.installerVersion ?? "earliest",
                );

                let installerPath = obsidianOptions.binaryPath;
                if (!installerPath) {
                    installerPath = await this.obsidianDownloader.downloadInstaller(installerVersionInfo.version);
                }
                let appPath = obsidianOptions.appPath;
                if (!appPath) {
                    appPath = await this.obsidianDownloader.downloadApp(appVersionInfo.version);
                }
                let chromedriverPath = cap['wdio:chromedriverOptions']?.binary
                // wdio can download chromedriver for versions greater than 115 automatically
                if (!chromedriverPath && Number(installerVersionInfo.chromeVersion!.split(".")[0]) <= 115) {
                    chromedriverPath = await this.obsidianDownloader.downloadChromedriver(installerVersionInfo.version);
                }

                let plugins = obsidianOptions.plugins ?? ["."];
                plugins.push(this.helperPluginPath); // Always install the helper plugin
                plugins = await this.obsidianDownloader.downloadPlugins(plugins);

                const themes = await this.obsidianDownloader.downloadThemes(obsidianOptions.themes ?? []);
    
                cap.browserName = "chrome";
                cap.browserVersion = installerVersionInfo.chromeVersion;
                cap[OBSIDIAN_CAPABILITY_KEY] = {
                    ...obsidianOptions,
                    plugins: plugins,
                    themes: themes,
                    binaryPath: installerPath,
                    appPath: appPath,
                    vault: vault,
                    appVersion: appVersionInfo.version, // Resolve the versions
                    installerVersion: installerVersionInfo.version,
                };
                cap['goog:chromeOptions'] = {
                    binary: installerPath,
                    windowTypes: ["app", "webview"],
                    ...cap['goog:chromeOptions'],
                }
                cap['wdio:chromedriverOptions'] = {
                    // allowedIps is not included in the types, but gets passed as --allowed-ips to chromedriver.
                    // It defaults to ["0.0.0.0"] which makes Windows Firewall complain, and we don't need remote
                    // connections anyways.
                    allowedIps: [],
                    ...cap['wdio:chromedriverOptions'],
                    binary: chromedriverPath,
                } as any
                cap["wdio:enforceWebDriverClassic"] = true;
            }
        } catch (e: any) {
            // By default wdio just logs service errors, throwing this makes it bail if anything goes wrong.
            throw new SevereServiceError(`Failed to download and setup Obsidian. Caused by: ${e.stack}\n`+
                                         ` ------The above causes:-----`);
        }
    }
}

export class ObsidianWorkerService implements Services.ServiceInstance {
    /** Directories to clean up after the tests */
    private tmpDirs: string[]

    constructor (
        public options: ObsidianServiceOptions,
        public capabilities: WebdriverIO.Capabilities,
        public config: Options.Testrunner
    ) {
        this.tmpDirs = [];
    }

    private async setupObsidian(obsidianOptions: ObsidianCapabilityOptions) {
        if (obsidianOptions.vault != undefined) {
            log.info(`Opening vault ${obsidianOptions.vault}`);
        }
        const tmpDir = await setupConfigAndVault({
            appVersion: obsidianOptions.appVersion!, installerVersion: obsidianOptions.installerVersion!,
            appPath: obsidianOptions.appPath!,
            vault: obsidianOptions.vault, copyVault: true,
            plugins: obsidianOptions.plugins as LocalPluginEntry[],
            themes: obsidianOptions.themes as LocalThemeEntry[],
        });
        this.tmpDirs.push(tmpDir);
        return tmpDir;
    }

    private async waitForReady(browser: WebdriverIO.Browser) {
        if ((await browser.getVaultPath()) != undefined) {
            await browser.waitUntil(
                async () => browser.execute("return !!window.optl?.app?.workspace?.onLayoutReady"),
                {timeout: 30 * 1000, interval: 200},
            );
            await browser.execute(`
                await new Promise((resolve) => { optl.app.workspace.onLayoutReady(resolve) });
            `);
        }
    }

    async beforeSession(config: Options.Testrunner, capabilities: WebdriverIO.Capabilities) {
        if (!capabilities[OBSIDIAN_CAPABILITY_KEY]) return;

        const tmpDir = await this.setupObsidian(capabilities[OBSIDIAN_CAPABILITY_KEY]);

        capabilities['goog:chromeOptions']!.args = [
            `--user-data-dir=${tmpDir}/config`,
            ...(capabilities['goog:chromeOptions']!.args ?? [])
        ];
    }

    private selectPlugins(currentPlugins: LocalPluginEntryWithId[], selection?: string[]) {
        if (selection !== undefined) {
            const unknownPlugins = _.difference(selection, currentPlugins.map(p => p.id));
            if (unknownPlugins.length > 0) {
                throw Error(`Unknown plugin ids: ${unknownPlugins.join(', ')}`)
            }
            return currentPlugins.map(p => ({
                ...p,
                enabled: selection.includes(p.id) || p.id == "optl-plugin",
            }));
        } else {
            return currentPlugins;
        }
    }

    private selectThemes(currentThemes: LocalThemeEntryWithName[], selection?: string) {
        if (selection !== undefined) {
            if (selection != "" && currentThemes.every((t: any) => t.name != selection)) {
                throw Error(`Unknown theme: ${selection}`)
            }
            // If themes is "" all will be disabled
            return currentThemes.map((t: any) => ({...t, enabled: t.name === selection}))
        } else {
            return currentThemes;
        }
    }

    async before(capabilities: WebdriverIO.Capabilities, specs: never, browser: WebdriverIO.Browser) {
        // There's a slow event listener link on the browser "command" event when you reloadSession that causes some
        // warnings. This will silence them. TODO: Make issue or PR to wdio to fix this.
        browser.setMaxListeners(1000);

        if (!capabilities[OBSIDIAN_CAPABILITY_KEY]) return;

        const service = this; // eslint-disable-line @typescript-eslint/no-this-alias
        await browser.addCommand("openVault",
            async function(this: WebdriverIO.Browser, vault?: string, plugins?: string[], theme?: string) {
                const oldObsidianOptions = this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY];

                const newObsidianOptions = {
                    ...oldObsidianOptions,
                    vault: vault != undefined ? path.resolve(vault) : oldObsidianOptions.vault,
                    plugins: service.selectPlugins(oldObsidianOptions.plugins, plugins),
                    themes: service.selectThemes(oldObsidianOptions.themes, theme),
                }

                const tmpDir = await service.setupObsidian(newObsidianOptions);
                
                const newArgs = [
                    `--user-data-dir=${tmpDir}/config`,
                    ...this.requestedCapabilities['goog:chromeOptions'].args.filter((arg: string) => {
                        const match = arg.match(/^--user-data-dir=(.*)\/config$/);
                        return !match || !service.tmpDirs.includes(match[1]);
                    }),
                ]

                // Reload session already merges with existing settings, and tries to restart the driver entirely if
                // you set browserName explicitly..
                const sessionId = await this.reloadSession({
                    [OBSIDIAN_CAPABILITY_KEY]: newObsidianOptions,
                    'goog:chromeOptions': {
                        ...this.requestedCapabilities['goog:chromeOptions'],
                        args: newArgs,
                    },
                });
                await service.waitForReady(this);

                return sessionId;
            }
        );

        for (const [name, cmd] of Object.entries(browserCommands)) {
            await browser.addCommand(name, cmd);
        }

        await service.waitForReady(browser);
    }

    async afterSession() {
        for (const tmpDir of this.tmpDirs) {
            await fsAsync.rm(tmpDir, { recursive: true, force: true });
        }
    }
}

export default ObsidianWorkerService;
export const launcher = ObsidianLauncherService;
