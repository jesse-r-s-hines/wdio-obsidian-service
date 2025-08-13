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
import { browserCommands } from "./browserCommands.js"
import {
    ObsidianServiceOptions, NormalizedObsidianCapabilityOptions, OBSIDIAN_CAPABILITY_KEY,
} from "./types.js"
import {
    isAppium, appiumUploadFolder, appiumDownloadFile, appiumUploadFile, getAppiumOptions, fileExists, quote,
 } from "./utils.js";
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
function selectPlugins(currentPlugins: DownloadedPluginEntry[], selection?: string[]): DownloadedPluginEntry[] {
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
function selectThemes(currentThemes: DownloadedThemeEntry[], selection?: string): DownloadedThemeEntry[] {
    if (selection !== undefined) {
        if (selection != "default" && currentThemes.every((t: any) => t.name != selection)) {
            throw Error(`Unknown theme: ${selection}`);
        }
        return currentThemes.map((t: any) => ({...t, enabled: selection != 'default' && t.name === selection}));
    } else {
        return currentThemes;
    }
}

function getNormalizedObsidianOptions(cap: WebdriverIO.Capabilities): NormalizedObsidianCapabilityOptions {
    return cap[OBSIDIAN_CAPABILITY_KEY] as NormalizedObsidianCapabilityOptions;
}


/**
 * Minimum Obsidian version that wdio-obsidian-service supports.
 * @category WDIO Helpers
 */
export const minSupportedObsidianVersion: string = "1.0.3"


/**
 * wdio launcher service.
 * Use in wdio.conf.mts like so:
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

                let appVersion = cap.browserVersion ?? cap[OBSIDIAN_CAPABILITY_KEY]?.appVersion ?? "latest";
                appVersion = (await this.obsidianLauncher.getVersionInfo(appVersion)).version;
                if (semver.lt(appVersion, minSupportedObsidianVersion)) {
                    throw Error(`Minimum supported Obsidian version is ${minSupportedObsidianVersion}`)
                }

                if (isAppium(cap)) {
                    let apk = getAppiumOptions(cap).app;
                    if (!apk) {
                        apk = await this.obsidianLauncher.downloadAndroid(appVersion);
                    }
                    let chromedriverDir = getAppiumOptions(cap).chromedriverExecutableDir;
                    if (!chromedriverDir) {
                        chromedriverDir = path.join(this.obsidianLauncher.cacheDir, 'appium-chromedriver');
                    }

                    const normalizedObsidianOptions: NormalizedObsidianCapabilityOptions = {
                        ...obsidianOptions,
                        plugins, themes, vault: vault,
                        appVersion, installerVersion: appVersion,
                        emulateMobile: false,
                    }
                    cap[OBSIDIAN_CAPABILITY_KEY] = normalizedObsidianOptions;
                    cap['appium:app'] = apk;
                    cap['appium:chromedriverExecutableDir'] = chromedriverDir;
                    cap["wdio:enforceWebDriverClassic"] = true; // BiDi doesn't seem to work on Obsidian mobile
                } else {
                    const [, installerVersion] = await this.obsidianLauncher.resolveVersion(
                        appVersion, obsidianOptions.installerVersion ?? "earliest",
                    );
                    const installerInfo = await this.obsidianLauncher.getInstallerInfo(installerVersion);

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

                    const normalizedObsidianOptions: NormalizedObsidianCapabilityOptions = {
                        ...obsidianOptions,
                        plugins, themes, vault,
                        binaryPath: installerPath, appPath: appPath,
                        appVersion, installerVersion,
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
            }
        } catch (e: any) {
            throw new SevereServiceError(getServiceErrorMessage(e));
        }
    }
}


/**
 * wdio worker service.
 * Use in wdio.conf.mts like so:
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
    /** Path on Android devices to store temporary vaults */
    private androidVaultDir = "/storage/emulated/0/Documents/wdio-obsidian-service-vaults";

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
     * Creates a copy of the vault with plugins and themes installed
     */
    private async setupVault(cap: WebdriverIO.Capabilities) {
        const obsidianOptions = getNormalizedObsidianOptions(cap);
        let vaultCopy: string|undefined;
        if (obsidianOptions.vault != undefined) {
            log.info(`Opening vault ${obsidianOptions.vault}`);
            vaultCopy = await this.obsidianLauncher.setupVault({
                vault: obsidianOptions.vault,
                copy: true,
                plugins: obsidianOptions.plugins,
                themes: obsidianOptions.themes,
            });
            this.tmpDirs.push(vaultCopy);
        } else {
            log.info(`Opening Obsidian without a vault`)
        }
        obsidianOptions.vaultCopy = vaultCopy; // for use in getVaultPath() and the other service hooks
    }

    /**
     * Sets up the --user-data-dir for the Electron app. Sets the obsidian.json in the dir to open the vault on boot.
     */
    private async electronSetupConfigDir(cap: WebdriverIO.Capabilities) {
        const obsidianOptions = getNormalizedObsidianOptions(cap);
        const configDir = await this.obsidianLauncher.setupConfigDir({
            appVersion: obsidianOptions.appVersion, installerVersion: obsidianOptions.installerVersion,
            appPath: obsidianOptions.appPath,
            vault: obsidianOptions.vaultCopy,
            // `app.emulateMobile` just sets this localStorage variable. Setting it ourselves here instead of calling
            // the function simplifies the boot/plugin load sequence and makes sure plugins load in mobile mode.
            localStorage: obsidianOptions.emulateMobile ? {"EmulateMobile": "1"} : {},
        });
        this.tmpDirs.push(configDir);

        cap['goog:chromeOptions'] = {
            ...cap['goog:chromeOptions'],
            args: [
                `--user-data-dir=${configDir}`,
                ...(cap['goog:chromeOptions']?.args ?? []).filter(arg => {
                    const match = arg.match(/^--user-data-dir=(.*)$/);
                    return !match || !this.tmpDirs.includes(match[1]);
                })
            ]
        }
    }

    /**
     * Opens the vault in appium.
     */
    private async appiumOpenVault() {
        const browser = this.browser!;
        const obsidianOptions = getNormalizedObsidianOptions(browser.requestedCapabilities);
        const androidVault = `${this.androidVaultDir}/${path.basename(obsidianOptions.vaultCopy!)}`;
        // TODO: Capabilities is not really the right place to be storing state like vaultCopy and uploadVault
        obsidianOptions.uploadedVault = androidVault;
        // transfer the vault to the device
        await appiumUploadFolder(browser, obsidianOptions.vaultCopy!, androidVault);

        // open vault by setting the localStorage keys and relaunching Obsidian
        // on appium restarting the app with appium:fullReset is *really* slow. And, unlike electron we can actually
        // switch vault with just a reload. So for Appium, instead of rebooting we manually wipe localStorage and use
        // reload to switch the vault.
        await browser.execute(async (androidVault) => {
            localStorage.clear();
            localStorage.setItem('mobile-external-vaults', JSON.stringify([androidVault]));
            localStorage.setItem('mobile-selected-vault', androidVault);
            // appId on mobile is just the full vault path
            localStorage.setItem(`enable-plugin-${androidVault}`, 'true');
            window.location.reload();
        }, androidVault);
    }

    /**
     * Sets appium app permissions and context
     */
    private async appiumSetContext() {
        const browser = this.browser!;
        // grant Obsidian the permissions it needs, mainly file access.
        // appium:autoGrantPermissions is supposed to automatically grant everything it needs, but I can't get it to
        // work. The "mobile: changePermissions" "all" option also doesn't seem to work here. I have to explicitly list
        // the permissions and use the "appops" target. See https://github.com/appium/appium/issues/19991
        // I'm calling "mobile: changePermissions" "all" as well just in case it is actually doing something

        await browser.execute("mobile: changePermissions", {
            action: "grant",
            appPackage: "md.obsidian",
            permissions: "all",
        });

        await browser.execute("mobile: changePermissions", {
            action: "allow",
            appPackage: "md.obsidian",
            permissions: [ // these are from apk AndroidManifest.xml (extracted with apktool)
                "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "MANAGE_EXTERNAL_STORAGE",
            ],
            target: "appops", // requires appium --allow-insecure adb_shell
        });

        await browser.switchContext("WEBVIEW_md.obsidian");
    }

    /**
     * Waits for Obsidian to be ready, and does some other final setup.
     */
    private async prepareApp() {
        const browser = this.browser!;
        const obsidianOptions = getNormalizedObsidianOptions(browser.requestedCapabilities);

        if (obsidianOptions.emulateMobile && obsidianOptions.vault != undefined) {
            // I don't think this is technically necessary, but when you set the window size via emulateMobile it sets
            // the window size in the browser view, but not the actual window size which looks weird and makes it hard
            // to manually debug a paused test. The normal ways to set window size don't work on Obsidian. Obsidian
            // doesn't respect the `--window-size` argument, and wdio setViewport and setWindowSize don't work without
            // BiDi. This resizes the window directly using electron APIs.
            await browser.waitUntil(() => browser.execute(() => !!(window as any).electron));
            const [width, height] = await browser.execute(() => [window.innerWidth, window.innerHeight]);
            await browser.execute(async (width, height) => {
                await (window as any).electron.remote.getCurrentWindow().setSize(width, height);
            }, width, height);
        }

        // wait until app is loaded
        if (obsidianOptions.vault) {
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

    private createReloadObsidian() {
        const service = this; // eslint-disable-line @typescript-eslint/no-this-alias
        const reloadObsidian: WebdriverIO.Browser['reloadObsidian'] = async function(
            this: WebdriverIO.Browser,
            {vault, plugins, theme} = {},
        ) {
            const oldObsidianOptions = getNormalizedObsidianOptions(this.requestedCapabilities);
            const selectedPlugins = selectPlugins(oldObsidianOptions.plugins, plugins);
            const selectedThemes = selectThemes(oldObsidianOptions.themes, theme);
            if (!vault && oldObsidianOptions.vaultCopy == undefined) {
                throw Error(`No vault is open, pass a vault path to reloadObsidian`);
            }
            const newObsidianOptions: NormalizedObsidianCapabilityOptions = {
                ...oldObsidianOptions,
                // Resolve relative to PWD instead of root dir during tests
                vault: vault ? path.resolve(vault) : oldObsidianOptions.vault,
                plugins: selectedPlugins, themes: selectedThemes,
            };

            if (isAppium(this.requestedCapabilities)) {
                this.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY] = newObsidianOptions;
                if (vault) {
                    await service.setupVault(this.requestedCapabilities);
                    await service.appiumOpenVault();
                } else {
                    // reload without resetting app state or triggering appium:fullReset

                    // hack to disable the Obsidian app and make sure it doesn't write to the vault while we modify it
                    await this.execute(() => {
                        window.location.replace('http://localhost/_capacitor_file_/not-a-file');
                    });

                    await this.pause(2000);

                    // while Obsidian is down, modify the vault files to setup plugins and themes
                    const local = path.join(oldObsidianOptions.vaultCopy!, ".obsidian");
                    const localCommunityPlugins = path.join(local, "community-plugins.json");
                    const localAppearance = path.join(local, "appearance.json");
                    const remote = `${oldObsidianOptions.uploadedVault!}/.obsidian`;
                    const remoteCommunityPlugins = `${remote}/community-plugins.json`;
                    const remoteAppearance = `${remote}/appearance.json`;

                    await appiumDownloadFile(this, remoteCommunityPlugins, localCommunityPlugins).catch(() => {});
                    await appiumDownloadFile(this, remoteAppearance, localAppearance).catch(() => {});
                    await service.obsidianLauncher.setupVault({
                        vault: oldObsidianOptions.vaultCopy!, copy: false,
                        plugins: selectedPlugins, themes: selectedThemes,
                    });
                    if (await fileExists(localCommunityPlugins)) {
                        await appiumUploadFile(this, localCommunityPlugins, remoteCommunityPlugins);
                    }
                    if (await fileExists(localAppearance)) {
                        await appiumUploadFile(this, localAppearance, remoteAppearance);
                    }
                
                    // switch the app back
                    await this.execute(() => {
                        window.location.replace('http://localhost/');
                    })
                }
            } else {
                // if browserName is set, reloadSession tries to restart the driver entirely, so unset those
                const newCap: WebdriverIO.Capabilities = _.cloneDeep(
                    _.omit(this.requestedCapabilities, ['browserName', 'browserVersion'])
                );
                newCap[OBSIDIAN_CAPABILITY_KEY] = newObsidianOptions;

                if (vault) {
                    await service.setupVault(newCap);
                    await service.electronSetupConfigDir(newCap);
                    await this.reloadSession(newCap);
                } else {
                    // reload preserving current vault and config dir

                    // Obsidian debounces saves to the config dir, and so changes to configuration made in the tests may
                    // not get saved to disk before the reboot. I haven't found a better way to flush everything than
                    // just waiting a bit.
                    await this.pause(2000);

                    await this.deleteSession({shutdownDriver: false});
                    // while Obsidian is down, modify the vault files to setup plugins and themes
                    await service.obsidianLauncher.setupVault({
                        vault: oldObsidianOptions.vaultCopy!, copy: false,
                        plugins: selectedPlugins, themes: selectedThemes,
                    });
                    await this.reloadSession(newCap);
                }
            }
            await service.prepareApp();
        };
        return reloadObsidian;
    }

    /**
     * Runs before the session and browser have started.
     */
    async beforeSession(config: Options.Testrunner, cap: WebdriverIO.Capabilities) {
        try {
            if (!cap[OBSIDIAN_CAPABILITY_KEY]) return;
            if (cap[OBSIDIAN_CAPABILITY_KEY].vault != undefined) {
                await this.setupVault(cap);
            }
            if (!isAppium(cap)) {
                await this.electronSetupConfigDir(cap);
            }
        } catch (e: any) {
            throw new SevereServiceError(getServiceErrorMessage(e));
        }
    }

    /**
     * Runs after session and browser have started, but before tests.
     */
    async before(cap: WebdriverIO.Capabilities, specs: unknown, browser: WebdriverIO.Browser) {
        this.browser = browser;
        try {
            if (!cap[OBSIDIAN_CAPABILITY_KEY]) return;

            // You are supposed to add commands via the addCommand hook, however you can't add synchronous methods that
            // way. Also, addCommand completely breaks the stack traces of errors from the methods, while tacking on the
            // methods manually doesn't.
            const newBrowserCommands = {
                ...browserCommands,
                reloadObsidian: this.createReloadObsidian(),
            }
            for (const [name, cmd] of Object.entries(newBrowserCommands)) {
                (browser as any)[name] = cmd;
            }

            if (isAppium(browser.requestedCapabilities)) {
                await this.appiumSetContext();
                if (cap[OBSIDIAN_CAPABILITY_KEY].vault) {
                    await this.appiumOpenVault();
                }
            }
            await this.prepareApp();
        } catch (e: any) {
            throw new SevereServiceError(getServiceErrorMessage(e));
        }
    }

    /** Runs after tests are done, but before the session is shut down */
    async after(result: number, cap: WebdriverIO.Capabilities) {
        const browser = this.browser!;
        if (!cap[OBSIDIAN_CAPABILITY_KEY]) return;

        if (isAppium(cap)) {
            const packageName = await browser.getCurrentPackage();
            await browser.execute('mobile: terminateApp', { appId: packageName });
            // "mobile: deleteFile" doesn't work on folders
            // "mobile:shell" requires appium --allow-insecure adb_shell
            await browser.execute("mobile: shell", {
                command: "rm", args: ["-rf", this.androidVaultDir],
            });
        }
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
