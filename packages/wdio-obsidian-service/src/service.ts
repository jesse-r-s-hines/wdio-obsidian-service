import fs from "fs"
import fsAsync from "fs/promises"
import path from "path"
import { SevereServiceError } from 'webdriverio'
import type { Capabilities, Options, Services } from '@wdio/types'
import logger from '@wdio/logger'
import { fileURLToPath } from "url"
import ObsidianLauncher, { DownloadedPluginEntry, DownloadedThemeEntry } from "obsidian-launcher"
import browserCommands from "./browserCommands.js"
import { ObsidianCapabilityOptions, ObsidianServiceOptions, OBSIDIAN_CAPABILITY_KEY } from "./types.js"
import obsidianPage from "./pageobjects/obsidianPage.js"
import { sleep } from "./utils.js"
import semver from "semver"
import _ from "lodash"


const log = logger("wdio-obsidian-service");

function getDefaultCacheDir() {
    return path.resolve(process.env.WEBDRIVER_CACHE_DIR ?? process.env.OBSIDIAN_CACHE ?? "./.obsidian-cache")
}

/**
 * Minimum Obsidian version that wdio-obsidian-service supports.
 */
export const minSupportedObsidianVersion: string = "1.0.3"


/**
 * wdio launcher service.
 * Use in wdio.conf.ts like so:
 * ```ts
 * services: ['obsidian'],
 * ```
 * @hidden
 */
export class ObsidianLauncherService implements Services.ServiceInstance {
    private obsidianLauncher: ObsidianLauncher
    private readonly helperPluginPath: string

    constructor (
        public options: ObsidianServiceOptions,
        public capabilities: WebdriverIO.Capabilities,
        public config: Options.Testrunner
    ) {
        this.obsidianLauncher = new ObsidianLauncher({
            cacheDir: config.cacheDir ?? getDefaultCacheDir(),
            versionsUrl: options.versionsUrl,
            communityPluginsUrl: options.communityPluginsUrl, communityThemesUrl: options.communityThemesUrl,
        });
        this.helperPluginPath = path.resolve(path.join(fileURLToPath(import.meta.url), '../../helper-plugin'));
    }

    /**
     * Validates wdio:obsidianOptions and downloads Obsidian, plugins, and themes.
     */
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
    
                const [appVersion, installerVersion] = await this.obsidianLauncher.resolveVersions(
                    cap.browserVersion ?? cap[OBSIDIAN_CAPABILITY_KEY]?.appVersion ?? "latest",
                    obsidianOptions.installerVersion ?? "earliest",
                );
                const installerVersionInfo = await this.obsidianLauncher.getVersionInfo(installerVersion);
                if (semver.lt(appVersion, minSupportedObsidianVersion)) {
                    throw Error(`Minimum supported Obsidian version is ${minSupportedObsidianVersion}`)
                }

                let installerPath = obsidianOptions.binaryPath;
                if (!installerPath) {
                    installerPath = await this.obsidianLauncher.downloadInstaller(installerVersion);
                }
                let appPath = obsidianOptions.appPath;
                if (!appPath) {
                    appPath = await this.obsidianLauncher.downloadApp(appVersion);
                }
                let chromedriverPath = cap['wdio:chromedriverOptions']?.binary
                // wdio can download chromedriver for versions greater than 115 automatically
                if (!chromedriverPath && Number(installerVersionInfo.chromeVersion!.split(".")[0]) <= 115) {
                    chromedriverPath = await this.obsidianLauncher.downloadChromedriver(installerVersion);
                }

                let plugins = obsidianOptions.plugins ?? ["."];
                plugins.push(this.helperPluginPath); // Always install the helper plugin
                plugins = await this.obsidianLauncher.downloadPlugins(plugins);

                const themes = await this.obsidianLauncher.downloadThemes(obsidianOptions.themes ?? []);

                if (obsidianOptions.vault != undefined && !fs.existsSync(obsidianOptions.vault)) {
                    throw Error(`Vault "${obsidianOptions.vault}" doesn't exist`)
                }

                const args = [
                    // Workaround for SUID issue on AppImages. See https://github.com/electron/electron/issues/42510
                    ...(process.platform == 'linux' ? ["--no-sandbox"] : []),
                    ...(cap['goog:chromeOptions']?.args ?? [])
                ];

                cap.browserName = "chrome";
                cap.browserVersion = installerVersionInfo.chromeVersion;
                cap[OBSIDIAN_CAPABILITY_KEY] = {
                    ...obsidianOptions,
                    plugins: plugins,
                    themes: themes,
                    binaryPath: installerPath,
                    appPath: appPath,
                    vault: vault,
                    appVersion: appVersion, // Resolve the versions
                    installerVersion: installerVersion,
                };
                cap['goog:chromeOptions'] = {
                    binary: installerPath,
                    windowTypes: ["app", "webview"],
                    ...cap['goog:chromeOptions'],
                    args: args,
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


/**
 * wdio worker service.
 * Use in wdio.conf.ts like so:
 * ```ts
 * services: ['obsidian'],
 * ```
 * @hidden
 */
export class ObsidianWorkerService implements Services.ServiceInstance {
    private obsidianLauncher: ObsidianLauncher
    /** Directories to clean up after the tests */
    private tmpDirs: string[]

    constructor (
        public options: ObsidianServiceOptions,
        public capabilities: WebdriverIO.Capabilities,
        public config: Options.Testrunner
    ) {
        this.obsidianLauncher = new ObsidianLauncher({
            cacheDir: config.cacheDir ?? getDefaultCacheDir(),
            versionsUrl: options.versionsUrl,
            communityPluginsUrl: options.communityPluginsUrl, communityThemesUrl: options.communityThemesUrl,
        });
        this.tmpDirs = [];
    }

    /**
     * Setup vault and config dir for a sandboxed Obsidian instance.
     */
    private async setupObsidian(obsidianOptions: ObsidianCapabilityOptions) {
        let vault = obsidianOptions.vault;
        if (vault != undefined) {
            log.info(`Opening vault ${obsidianOptions.vault}`);
            vault = await this.obsidianLauncher.setupVault({
                vault,
                copy: true,
                plugins: obsidianOptions.plugins,
                themes: obsidianOptions.themes,
            });
            this.tmpDirs.push(vault);
        } else {
            log.info(`Opening Obsidian without a vault`)
        }

        const configDir = await this.obsidianLauncher.setupConfigDir({
            appVersion: obsidianOptions.appVersion!, installerVersion: obsidianOptions.installerVersion!,
            appPath: obsidianOptions.appPath!,
            vault: vault,
        });
        this.tmpDirs.push(configDir);

        return configDir;
    }

    /**
     * Wait for Obsidian to fully boot.
     */
    private async waitForReady(browser: WebdriverIO.Browser) {
        if (browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].vault != undefined) {
            await browser.waitUntil( // wait until the helper plugin is loaded
                () => browser.execute(() => !!(window as any).wdioObsidianService),
                {timeout: 30 * 1000, interval: 100},
            );
            await browser.executeObsidian(async ({app}) => {
                await new Promise<void>((resolve) => app.workspace.onLayoutReady(resolve) );
            })
        } else {
            await browser.execute(async () => {
                if (document.readyState === "loading") {
                    return new Promise<void>(resolve => document.addEventListener("DOMContentLoaded", () => resolve()));
                }
            })
        }
    }

    /**
     * Handles vault and sandboxed config directory setup.
     */
    async beforeSession(config: Options.Testrunner, capabilities: WebdriverIO.Capabilities) {
        if (!capabilities[OBSIDIAN_CAPABILITY_KEY]) return;

        const configDir = await this.setupObsidian(capabilities[OBSIDIAN_CAPABILITY_KEY]);

        capabilities['goog:chromeOptions']!.args = [
            `--user-data-dir=${configDir}`,
            ...(capabilities['goog:chromeOptions']!.args ?? [])
        ];
    }

    /**
     * Returns a plugin list with only the selected plugin ids enabled.
     */
    private selectPlugins(currentPlugins: DownloadedPluginEntry[], selection?: string[]) {
        if (selection !== undefined) {
            const unknownPlugins = _.difference(selection, currentPlugins.map(p => p.id));
            if (unknownPlugins.length > 0) {
                throw Error(`Unknown plugin ids: ${unknownPlugins.join(', ')}`)
            }
            return currentPlugins.map(p => ({
                ...p,
                enabled: selection.includes(p.id) || p.id == "wdio-obsidian-service-plugin",
            }));
        } else {
            return currentPlugins;
        }
    }

    /**
     * Returns a theme list with only the selected theme enabled.
     */
    private selectThemes(currentThemes: DownloadedThemeEntry[], selection?: string) {
        if (selection !== undefined) {
            if (selection != "default" && currentThemes.every((t: any) => t.name != selection)) {
                throw Error(`Unknown theme: ${selection}`);
            }
            return currentThemes.map((t: any) => ({...t, enabled: selection != 'default' && t.name === selection}));
        } else {
            return currentThemes;
        }
    }

    /**
     * Setup custom browser commands.
     */
    async before(capabilities: WebdriverIO.Capabilities, specs: never, browser: WebdriverIO.Browser) {
        if (!capabilities[OBSIDIAN_CAPABILITY_KEY]) return;

        const service = this; // eslint-disable-line @typescript-eslint/no-this-alias
        const reloadObsidian: typeof browser['reloadObsidian'] = async function(
            this: WebdriverIO.Browser,
            {vault, plugins, theme} = {},
        ) {
            const oldObsidianOptions = this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY];
            let newCapabilities: WebdriverIO.Capabilities

            if (vault) {
                const newObsidianOptions = {
                    ...oldObsidianOptions,
                    vault: path.resolve(vault),
                    plugins: service.selectPlugins(oldObsidianOptions.plugins, plugins),
                    themes: service.selectThemes(oldObsidianOptions.themes, theme),
                }
    
                const configDir = await service.setupObsidian(newObsidianOptions);
                
                const newArgs = [
                    `--user-data-dir=${configDir}`,
                    ...this.requestedCapabilities['goog:chromeOptions'].args.filter((arg: string) => {
                        const match = arg.match(/^--user-data-dir=(.*)$/);
                        return !match || !service.tmpDirs.includes(match[1]);
                    }),
                ]
                
                newCapabilities = {
                    [OBSIDIAN_CAPABILITY_KEY]: newObsidianOptions,
                    'goog:chromeOptions': {
                        ...this.requestedCapabilities['goog:chromeOptions'],
                        args: newArgs,
                    },
                };
            } else {
                // preserve vault and config dir
                newCapabilities = {};
                // Since we aren't recreating the vault, we'll need to reset plugins and themes here if specified.
                if (plugins) {
                    const enabledPlugins = await browser.executeObsidian(({app}) =>
                        [...(app as any).plugins.enabledPlugins].sort()
                    )
                    for (const pluginId of _.difference(enabledPlugins, plugins, ['wdio-obsidian-service-plugin'])) {
                        await obsidianPage.disablePlugin(pluginId);
                    }
                    for (const pluginId of _.difference(plugins, enabledPlugins)) {
                        await obsidianPage.enablePlugin(pluginId);
                    }
                }
                if (theme) {
                    await obsidianPage.setTheme(theme);
                }
                // Obsidian debounces saves to the config dir, and so changes to configuration made in the tests may not
                // get saved to disk before the reboot. Here I manually trigger save for plugins and themes, but other
                // configurations might not get saved. I haven't found a better way to flush everything than just
                // waiting a bit. Wdio has ways to mock the clock, which might work, but it's only supported when using
                // BiDi, which I can't get working on Obsidian.
                await browser.executeObsidian(async ({app}) => await Promise.all([
                    (app as any).plugins.saveConfig(),
                    (app.vault as any).saveConfig(),
                ]))
                await sleep(2000);
            }

            const sessionId = await browser.reloadSession({
                // if browserName is set, reloadSession tries to restart the driver entirely, so unset those
                ..._.omit(this.requestedCapabilities, ['browserName', 'browserVersion']),
                ...newCapabilities,
            });
            await service.waitForReady(this);
            return sessionId;
        }

        await browser.addCommand("reloadObsidian", reloadObsidian);

        for (const [name, cmd] of Object.entries(browserCommands)) {
            await browser.addCommand(name, cmd);
        }

        await service.waitForReady(browser);
    }

    /**
     * Cleanup
     */
    async afterSession() {
        for (const tmpDir of this.tmpDirs) {
            await fsAsync.rm(tmpDir, { recursive: true, force: true });
        }
    }
}
