import fs from "fs"
import fsAsync from "fs/promises"
import path from "path"
import { SevereServiceError } from 'webdriverio'
import type { Capabilities, Options, Services } from '@wdio/types'
import logger from '@wdio/logger'
import { fileURLToPath } from "url"
import ObsidianLauncher, {
    PluginEntry, ThemeEntry, DownloadedPluginEntry, DownloadedThemeEntry,
} from "obsidian-launcher"
import { asyncBrowserCommands, syncBrowserCommands } from "./browserCommands.js"
import {
    ObsidianServiceOptions, NormalizedObsidianCapabilityOptions, OBSIDIAN_CAPABILITY_KEY,
} from "./types.js"
import { sleep } from "./utils.js"
import semver from "semver"
import _ from "lodash"


const log = logger("wdio-obsidian-service");

function getDefaultCacheDir(rootDir: string) {
    return path.resolve(rootDir, process.env.WEBDRIVER_CACHE_DIR ?? process.env.OBSIDIAN_CACHE ?? "./.obsidian-cache");
}

/** By default wdio continues on service errors, so we throw a SevereServiceError to make it bail on error */
function getServiceErrorMessage(e: any) {
    return (
        `Failed to download and setup Obsidian. Caused by:\n` +
        `${e.stack}\n`+
        ` ------The above causes:-----`
    );
}

function resolveEntry(rootDir: string, entry: PluginEntry|ThemeEntry): PluginEntry|ThemeEntry {
    if (typeof entry == "string") {
        return path.resolve(rootDir, entry);
    } else if ('path' in entry) {
        return {...entry, path: path.resolve(rootDir, entry.path)};
    } else {
        return entry;
    }
}

/** Returns a plugin list with only the selected plugin ids enabled. */
function selectPlugins(currentPlugins: DownloadedPluginEntry[], selection?: string[]) {
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

/** Returns a theme list with only the selected theme enabled. */
function selectThemes(currentThemes: DownloadedThemeEntry[], selection?: string) {
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
 * Minimum Obsidian version that wdio-obsidian-service supports.
 * @category WDIO Helpers
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
    private readonly rootDir: string

    constructor (
        public options: ObsidianServiceOptions,
        public capabilities: WebdriverIO.Capabilities,
        public config: Options.Testrunner
    ) {
        this.rootDir = config.rootDir || process.cwd();
        this.obsidianLauncher = new ObsidianLauncher({
            cacheDir: config.cacheDir ?? getDefaultCacheDir(this.rootDir),
            versionsUrl: options.versionsUrl,
            communityPluginsUrl: options.communityPluginsUrl, communityThemesUrl: options.communityThemesUrl,
        });
        this.helperPluginPath = path.resolve(fileURLToPath(import.meta.url), '../../helper-plugin');
    }

    /**
     * Validates wdio:obsidianOptions and downloads Obsidian, plugins, and themes.
     */
    async onPrepare(config: Options.Testrunner, capabilities: Capabilities.TestrunnerCapabilities) {
        try {
            if (!Array.isArray(capabilities)) {
                capabilities = Object.values(capabilities).map(
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

            for (const cap of obsidianCapabilities) {
                const obsidianOptions = cap[OBSIDIAN_CAPABILITY_KEY] ?? {};
    
                // check vault
                const vault = obsidianOptions.vault ? path.resolve(this.rootDir, obsidianOptions.vault) : undefined;
                if (vault && !fs.existsSync(vault)) {
                    throw Error(`Vault "${vault}" doesn't exist`)
                }
    
                // download plugins and themes to cache
                const plugins = await this.obsidianLauncher.downloadPlugins(
                    (obsidianOptions.plugins ?? [])
                        .concat([this.helperPluginPath]) // Always install the helper plugin
                        .map(p => resolveEntry(this.rootDir, p) as PluginEntry)
                );

                const themes = await this.obsidianLauncher.downloadThemes(
                    (obsidianOptions.themes ?? [])
                        .map(t => resolveEntry(this.rootDir, t) as ThemeEntry),
                );

                // resolve Obsidian versions
                const [appVersion, installerVersion] = await this.obsidianLauncher.resolveVersions(
                    cap.browserVersion ?? cap[OBSIDIAN_CAPABILITY_KEY]?.appVersion ?? "latest",
                    obsidianOptions.installerVersion ?? "earliest",
                );
                if (semver.lt(appVersion, minSupportedObsidianVersion)) {
                    throw Error(`Minimum supported Obsidian version is ${minSupportedObsidianVersion}`)
                }
                const installerInfo = await this.obsidianLauncher.getInstallerInfo(installerVersion);

                // download Obsidian
                let installerPath: string;
                if (obsidianOptions.binaryPath) {
                    installerPath = path.resolve(this.rootDir, obsidianOptions.binaryPath)
                } else {
                    installerPath = await this.obsidianLauncher.downloadInstaller(installerVersion);
                }
                let appPath: string;
                if (obsidianOptions.appPath) {
                    appPath = path.resolve(this.rootDir, obsidianOptions.appPath)
                } else {
                    appPath = await this.obsidianLauncher.downloadApp(appVersion);
                }
                let chromedriverPath = cap['wdio:chromedriverOptions']?.binary;
                // wdio can't download chromedriver for versions less than 115 automatically. Fetching it ourselves is
                // also a bit faster as it skips the chromedriver version detection step.
                if (!chromedriverPath) {
                    chromedriverPath = await this.obsidianLauncher.downloadChromedriver(installerVersion);
                }

                // setup capabilities
                const normalizedObsidianOptions: NormalizedObsidianCapabilityOptions = {
                    ...obsidianOptions,
                    plugins: plugins,
                    themes: themes,
                    binaryPath: installerPath,
                    appPath: appPath,
                    vault: vault,
                    appVersion: appVersion,
                    installerVersion: installerVersion,
                    emulateMobile: obsidianOptions.emulateMobile ?? false,
                }

                cap.browserName = "chrome";
                cap.browserVersion = installerInfo.chrome;
                cap[OBSIDIAN_CAPABILITY_KEY] = normalizedObsidianOptions;
                cap['goog:chromeOptions'] = {
                    binary: installerPath,
                    windowTypes: ["app", "webview"],
                    ...cap['goog:chromeOptions'],
                    args: [
                        // Workaround for SUID issue on linux. See https://github.com/electron/electron/issues/42510
                        ...(process.platform == 'linux' ? ["--no-sandbox"] : []),
                        ...(cap['goog:chromeOptions']?.args ?? [])
                    ],
                }
                cap['wdio:chromedriverOptions'] = {
                    // allowedIps is not included in the types, but gets passed as --allowed-ips to chromedriver.
                    // It defaults to ["0.0.0.0"] which makes Windows Firewall complain, and we don't need remote
                    // connections anyways.
                    allowedIps: [],
                    ...cap['wdio:chromedriverOptions'],
                    binary: chromedriverPath,
                } as any
                cap["wdio:enforceWebDriverClassic"] = true; // electron doesn't support BiDi yet.
            }
        } catch (e: any) {
            throw new SevereServiceError(getServiceErrorMessage(e));
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
    private browser: WebdriverIO.Browser|undefined;
    /** Directories to clean up after the tests */
    private tmpDirs: string[]

    constructor (
        public options: ObsidianServiceOptions,
        public capabilities: WebdriverIO.Capabilities,
        public config: Options.Testrunner
    ) {
        this.obsidianLauncher = new ObsidianLauncher({
            cacheDir: config.cacheDir ?? getDefaultCacheDir(config.rootDir || process.cwd()),
            versionsUrl: options.versionsUrl,
            communityPluginsUrl: options.communityPluginsUrl, communityThemesUrl: options.communityThemesUrl,
        });
        this.tmpDirs = [];
    }

    /**
     * Called in beforeSession hook. Set up the vault and config dir for a sandboxed Obsidian instance.
     * Mutates input capabilities.
     */
    private async preBootSetup(cap: WebdriverIO.Capabilities): Promise<void> {
        const obsidianOptions = cap[OBSIDIAN_CAPABILITY_KEY] as NormalizedObsidianCapabilityOptions;
        let vault = obsidianOptions.vault;
        if (vault != undefined) {
            log.info(`Opening vault ${vault}`);
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
            appVersion: obsidianOptions.appVersion, installerVersion: obsidianOptions.installerVersion,
            appPath: obsidianOptions.appPath,
            vault: vault,
            // `app.emulateMobile` just sets this localStorage variable. Setting it ourselves here instead of calling
            // the function simplifies the boot/plugin load sequence and makes sure plugins load in mobile mode.
            localStorage: obsidianOptions.emulateMobile ? {"EmulateMobile": "1"} : {},
        });
        this.tmpDirs.push(configDir);

        obsidianOptions.vaultCopy = vault; // for use in getVaultPath()
        if (!cap['goog:chromeOptions']) cap['goog:chromeOptions'] = {};
        cap['goog:chromeOptions'].args = [
            `--user-data-dir=${configDir}`,
            ...(cap['goog:chromeOptions'].args ?? []).filter(arg => {
                const match = arg.match(/^--user-data-dir=(.*)$/);
                return !match || !this.tmpDirs.includes(match[1]);
            })
        ];
    }

    /**
     * Called in before hook. Wait for Obsidian to fully boot and do some other setup after Obsidian has booted.
     */
    private async postBootSetup() {
        const browser = this.browser!;
        const obsidianOptions: NormalizedObsidianCapabilityOptions = browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY];
        if (obsidianOptions.vault != undefined) {
            // I don't think this is technically necessary, but when you set the window size via emulateMobile it sets
            // the window size in the browser view, but not the actual window size which looks weird and makes it hard
            // to manually debug a paused test.
            // The normal ways to set window size don't work on Obsidian. Obsidian doesn't respect the `--window-size`
            // argument, and wdio setViewport and setWindowSize don't work without BiDi. This method resizes the window
            // directly using electron APIs.
            const chromeOptions = browser.requestedCapabilities['goog:chromeOptions'];
            if (chromeOptions?.mobileEmulation) {
                const [width, height] = await browser.execute(() => [window.innerWidth, window.innerHeight]);
                await browser.execute(async (width, height) => {
                    await (window as any).electron.remote.getCurrentWindow().setSize(width, height);
                }, width, height);
            }

            await browser.waitUntil( // wait until the helper plugin is loaded
                () => browser.execute(() => !!(window as any).wdioObsidianService),
                {timeout: 30 * 1000, interval: 100},
            );
            await browser.executeObsidian(async ({app}) => {
                await new Promise<void>((resolve) => app.workspace.onLayoutReady(resolve));
            });
        } else {
            await browser.execute(async () => {
                if (document.readyState === "loading") {
                    return new Promise<void>(resolve => document.addEventListener("DOMContentLoaded", () => resolve()));
                }
            });
        }
    }

    /**
     * Handles vault and sandboxed config directory setup.
     */
    async beforeSession(config: Options.Testrunner, capabilities: WebdriverIO.Capabilities) {
        try {
            if (!capabilities[OBSIDIAN_CAPABILITY_KEY]) return;
            await this.preBootSetup(capabilities);
        } catch (e: any) {
            throw new SevereServiceError(getServiceErrorMessage(e));
        }
    }

    /**
     * Setup custom browser commands.
     */
    async before(capabilities: WebdriverIO.Capabilities, specs: unknown, browser: WebdriverIO.Browser) {
        this.browser = browser;
        try {
            if (!capabilities[OBSIDIAN_CAPABILITY_KEY]) return;

            // There is a slow event listener link on the browser "command" event when you reloadSession that causes
            // some warnings. This will silence them. TODO: Make issue or PR to wdio to fix this.
            browser.setMaxListeners(1000);

            browser.addCommand("reloadObsidian", this.createReloadObsidian());
            for (const [name, cmd] of Object.entries(asyncBrowserCommands)) {
                browser.addCommand(name, cmd);
            }
            for (const [name, cmd] of Object.entries(syncBrowserCommands)) {
                (browser as any)[name] = cmd; // Hack to allow adding some sync methods to browser
            }

            await this.postBootSetup();
        } catch (e: any) {
            throw new SevereServiceError(getServiceErrorMessage(e));
        }
    }

    private createReloadObsidian() {
        const service = this; // eslint-disable-line @typescript-eslint/no-this-alias
        const reloadObsidian: WebdriverIO.Browser['reloadObsidian'] = async function(
            this: WebdriverIO.Browser,
            {vault, plugins, theme} = {},
        ) {
            const oldObsidianOptions: NormalizedObsidianCapabilityOptions = this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY];
            // if browserName is set, reloadSession tries to restart the driver entirely, so unset those
            const newCapabilities: WebdriverIO.Capabilities = _.cloneDeep(
                _.omit(this.requestedCapabilities, ['browserName', 'browserVersion'])
            );

            if (vault) {
                const newObsidianOptions: NormalizedObsidianCapabilityOptions = {
                    ...oldObsidianOptions,
                    // Resolve relative to PWD instead of root dir during tests
                    vault: path.resolve(vault),
                    plugins: selectPlugins(oldObsidianOptions.plugins, plugins),
                    themes: selectThemes(oldObsidianOptions.themes, theme),
                }
                newCapabilities[OBSIDIAN_CAPABILITY_KEY] = newObsidianOptions;
                await service.preBootSetup(newCapabilities);
            } else {
                // preserve vault and config dir
                const obsidianPage = this.getObsidianPage();
                // Since we aren't recreating the vault, we'll need to enable/disable plugins and themes here.
                if (plugins) {
                    const enabledPlugins = await this.executeObsidian(({app}) =>
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
                await this.executeObsidian(async ({app}) => await Promise.all([
                    (app as any).plugins.saveConfig(),
                    (app.vault as any).saveConfig(),
                ]))
                // Obsidian debounces saves to the config dir, and so changes to configuration made in the tests may not
                // get saved to disk before the reboot. Here I manually trigger save for plugins and themes, but other
                // configurations might not get saved. I haven't found a better way to flush everything than just
                // waiting a bit. Wdio has ways to mock the clock which might work, but it's only supported when using
                // BiDi which I can't get working on Obsidian.
                await sleep(2000);
            }

            const sessionId = await this.reloadSession(newCapabilities);
            await service.postBootSetup();

            return sessionId;
        };
        return reloadObsidian;
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
