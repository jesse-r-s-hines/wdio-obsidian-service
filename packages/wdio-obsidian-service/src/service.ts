import fs from "fs"
import fsAsync from "fs/promises"
import path from "path"
import crypto from "crypto"
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
    isAppium, appiumUploadFiles, appiumDownloadFile, appiumExists, appiumReaddir, getAppiumOptions, fileExists,
    navigateAndWait, retry,
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
        if (selection != "default" && currentThemes.every(t => t.name != selection)) {
            throw Error(`Unknown theme: ${selection}`);
        }
        return currentThemes.map(t => ({...t, enabled: selection != 'default' && t.name === selection}));
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

/** Path on Android devices to store temporary vaults */
const androidVaultsDir = "/storage/emulated/0/Documents/wdio-obsidian-service-vaults";

const OBSIDIAN_HANG_ERROR = Symbol("hang");


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
            // Create an ID that is unique per test run, but the same between sessions.
            const runId = crypto.randomBytes(10).toString("base64url").replace(/[-_]/g, '0');

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
                        copy: obsidianOptions.copy ?? true,
                        appVersion, installerVersion: appVersion,
                        emulateMobile: false,
                        testRunId: runId,
                    }
                    cap[OBSIDIAN_CAPABILITY_KEY] = normalizedObsidianOptions;
                    cap['appium:app'] = apk;
                    cap['appium:chromedriverExecutableDir'] = chromedriverDir;
                    cap["wdio:enforceWebDriverClassic"] = true; // BiDi doesn't seem to work on Obsidian mobile
                    // appium-service expects these to not be set
                    delete cap.browserName;
                    delete cap.browserVersion;
                    if (!getAppiumOptions(cap)['noReset']) {
                        log.warn("Note: For best performance set noReset to true, wdio-obsidian-service will handle resetting Obsidian between tests.")
                    }
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
                        copy: obsidianOptions.copy ?? true,
                        binaryPath: installerPath, appPath: appPath,
                        appVersion, installerVersion,
                        emulateMobile: obsidianOptions.emulateMobile ?? false,
                        testRunId: runId,
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
                    } as WebdriverIO.ChromedriverOptions;
                    cap["wdio:enforceWebDriverClassic"] = true; // electron doesn't support BiDi yet.
                }
            }

            // show a warning if doing parallel tests on no copy vaults
            const dupNoCopyVaults = _(obsidianCapabilities)
                .map(cap => cap[OBSIDIAN_CAPABILITY_KEY])
                .filter(cap => !!cap && cap.copy === false && !!cap.vault)
                .map(cap => cap!.vault!)
                .countBy(v => v)
                .pickBy(count => count >= 2)
                .keys()
                .sort()
                .value()
            if (config.maxInstances !== 1 && dupNoCopyVaults.length > 0) {
                log.warn(
                    `Multiple capabilities share the same vault with \`copy: false\`. This means parallel tests will run ` +
                    `on the same directory which can cause errors. Either set \`copy: true\` or set \`maxInstances: 1\`. ` +
                    `Affected vaults: ${dupNoCopyVaults.join(', ')}`
                )
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
     * Sets up the vault with plugins and themes installed, optionally copying it first.
     */
    private async setupVault(cap: WebdriverIO.Capabilities) {
        const obsidianOptions = getNormalizedObsidianOptions(cap);
        let openVault: string|undefined;
        if (obsidianOptions.vault != undefined) {
            const shouldCopy = obsidianOptions.copy;
            log.info(`Opening vault ${obsidianOptions.vault}${obsidianOptions.copy ? ' (copy)' : ' (in-place)'}`);
            openVault = await this.obsidianLauncher.setupVault({
                vault: obsidianOptions.vault,
                copy: shouldCopy,
                plugins: obsidianOptions.plugins,
                themes: obsidianOptions.themes,
            });
            if (shouldCopy) {
                this.tmpDirs.push(openVault);
            }
        } else {
            log.info(`Opening Obsidian without a vault`)
        }
        obsidianOptions.openVault = openVault; // for use in getVaultPath() and the other service hooks
    }

    /**
     * Sets up the --user-data-dir for the Electron app. Sets the obsidian.json in the dir to open the vault on boot.
     */
    private async electronSetupConfigDir(cap: WebdriverIO.Capabilities) {
        const obsidianOptions = getNormalizedObsidianOptions(cap);
        const configDir = await this.obsidianLauncher.setupConfigDir({
            appVersion: obsidianOptions.appVersion, installerVersion: obsidianOptions.installerVersion,
            appPath: obsidianOptions.appPath,
            vault: obsidianOptions.openVault,
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
     * Sets up the Obsidian app. Installs and launches it if needed, and sets permissions and contexts.
     * 
     * You can configure Appium to install and launch the app for you. However, if you do that it reboots the app after
     * every session/spec which is really slow. So we are handling the app setup manually here.
     */
    private async appiumSetupApp() {
        const browser = this.browser!;
        const appiumOptions = getAppiumOptions(browser.requestedCapabilities);
        const obsidianOptions = getNormalizedObsidianOptions(browser.requestedCapabilities);
        const appId = "md.obsidian";

        // install/reinstall Obsidian if needed
        const dumpsys: string = await browser.execute("mobile: shell", {command: "dumpsys", args: ["package", appId]});
        const installedObsidianVersion = dumpsys.match(/versionName[=:](.*)$/m)?.[1]?.trim();
        if (installedObsidianVersion != obsidianOptions.appVersion) {
            await browser.execute('mobile: terminateApp', {appId}); // terminate app (if running)
            await browser.execute('mobile: removeApp', {appId, keepData: false}); // uninstall (if present)
            await browser.execute('mobile: installApp', {
                appPath: appiumOptions.app, // the APK
                timeout: appiumOptions.androidInstallTimeout, // respect appium configuration
                grantPermissions: true, // this and autoGrantPermissions don't seem to really work, see below
            });
        }

        // start app if needed
        const appState: number = await browser.execute("mobile: queryAppState", {appId});
        if (appState < 4) { // 0: not installed, 1: not running, 3: running in background, 4: running in foreground
            await browser.execute("mobile: activateApp", {appId});
        }

        // grant Obsidian the permissions it needs, mainly file access.
        // appium:autoGrantPermissions is supposed to automatically grant everything it needs, but I can't get it to
        // work. The "mobile: changePermissions" "all" option also doesn't seem to work here. I have to explicitly list
        // the permissions and use the "appops" target. See https://github.com/appium/appium/issues/19991
        // I'm calling "mobile: changePermissions" "all" as well just in case it is actually doing something
        await browser.execute("mobile: changePermissions", {
            action: "grant",
            appPackage: appId,
            permissions: "all",
        });
        await browser.execute("mobile: changePermissions", {
            action: "allow",
            appPackage: appId,
            permissions: [ // these are from apk AndroidManifest.xml (extracted with apktool)
                "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "MANAGE_EXTERNAL_STORAGE",
            ],
            target: "appops", // requires appium --allow-insecure adb_shell
        });

        // switch to the webview context
        const context = "WEBVIEW_md.obsidian";
        await browser.waitUntil(
            async () => (await browser.getContexts() as string[]).includes(context),
            {timeout: 30_000, interval: 100},
        );
        await browser.switchContext(context);

        // Clear app state
        await browser.execute(() => { // in case tests get interrupted during the `_capacitor_file_` bit
            if (window.location.href != "http://localhost/") {
                window.location.replace('http://localhost/');
            }
        })
        if (!obsidianOptions.vault) { // skip if vault is set, as we'll clear state when we open the new vault
            await this.appiumCloseVault();
        }
    }

    /**
     * Opens the vault in appium.
     */
    private async appiumOpenVault() {
        const browser = this.browser!;
        const obsidianOptions = getNormalizedObsidianOptions(browser.requestedCapabilities);

        // create a path based on the openVault.
        // if copy: true, openVault path is randomized so the has hash will also be unique
        // if copy: false, openVault is same as vault, so we'll reuse an already uploaded vault
        // We include the runId and if its a copy so we can know what to clean up at the end of the tests
        // We want to make sure that nocopy vaults are still uploaded ONCE at the beginning of tests, even if the last
        // test run didn't clean up androidVaultsDir properly.
        const runId = obsidianOptions.testRunId;
        const pathHash = crypto.createHash("SHA256").update(obsidianOptions.openVault!).digest("base64url").replace(/[-_]/g, '0').slice(0, 10);
        const basename = path.basename(obsidianOptions.vault!);
        const androidVault = `${androidVaultsDir}/${basename}-${pathHash}-${runId}-${obsidianOptions.copy ? '' : 'no'}copy`;
        obsidianOptions.androidVault = androidVault;

        // transfer the vault to the device
        if (!(await appiumExists(browser, androidVault))) {
            await appiumUploadFiles(browser, {src: obsidianOptions.openVault!, dest: androidVault});
        }

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
        }, androidVault);
        await navigateAndWait(browser, () => location.reload());
    }

    /**
     * Close any open vault and go back to the vault switcher
     */
    private async appiumCloseVault() {
        const browser = this.browser!;
        // skip if we're already on the vault switcher
        if (await browser.execute(() => localStorage.length > 0)) {
            await browser.execute(() => localStorage.clear());
            await navigateAndWait(browser, () => location.reload());
        }
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
            await browser.waitUntil(
                () => browser.execute(() => !!(window as any).electron),
                {timeout: 10_000, interval: 100},
            );
            const [width, height] = await browser.execute(() => [window.innerWidth, window.innerHeight]);
            await browser.execute(async (width, height) => {
                await (window as any).electron.remote.getCurrentWindow().setSize(width, height);
            }, width, height);
        }

        // wait until app is loaded
        if (obsidianOptions.vault) {
            if (isAppium(browser.requestedCapabilities) && semver.gte(obsidianOptions.appVersion, '1.12.0')) {
                // Obsidian >= 1.12.0 has a bug on mobile startup that intermittently causes the app to get stuck during
                // boot in the emulator. Seems to be caused by changes to the Capacitor plugin load sequence and a race
                // condition with the Capacitor bridge. Not sure why it doesn't show up in real usage, probably just the
                // race condition only losing on the sluggish emulator. Only work around I've found is to just detect the
                // state and trigger a refresh.
                await retry(async (attempt) => {
                    if (attempt > 0) {
                        console.warn("Obsidian Android app stuck, relaunching...");
                        await navigateAndWait(browser, () => location.reload());
                    }
                    await browser.waitUntil(
                        () => browser.execute(() => !!window.ready), // wait for enhance.js to be loaded
                        {timeout: 60_000, interval: 100},
                    );
                    await browser.waitUntil( // if this fails to load soon after, we are in the hang state
                        () => browser.execute(() => document.body?.classList.contains("is-mobile")),
                        {timeout: 2_000, interval: 100},
                    ).catch(() => {
                        throw OBSIDIAN_HANG_ERROR; // eslint-disable-line @typescript-eslint/only-throw-error
                    });
                }, {
                    retries: 2,
                    backoff: 2000,
                    retryIf: (error) => error === OBSIDIAN_HANG_ERROR,
                });
            }
            await browser.waitUntil( // wait until the helper plugin is loaded
                () => browser.execute(() => !!(window as any).wdioObsidianService),
                {timeout: 60_000, interval: 100},
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
            {vault, copy = true, plugins, theme} = {},
        ) {
            const oldObsidianOptions = getNormalizedObsidianOptions(this.requestedCapabilities);
            const selectedPlugins = selectPlugins(oldObsidianOptions.plugins, plugins);
            const selectedThemes = selectThemes(oldObsidianOptions.themes, theme);
            if (!vault && oldObsidianOptions.openVault == undefined) {
                throw Error(`No vault is open, pass a vault path to reloadObsidian`);
            }
            const newObsidianOptions: NormalizedObsidianCapabilityOptions = {
                ...oldObsidianOptions,
                // Resolve relative to PWD instead of root dir during tests
                vault: vault ? path.resolve(vault) : oldObsidianOptions.vault,
                copy,
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
                    await navigateAndWait(this, () => location.replace('http://localhost/_capacitor_file_/not-a-file'));

                    // while Obsidian is down, modify the vault files to setup plugins and themes
                    const local = path.join(oldObsidianOptions.openVault!, ".obsidian");
                    const localCommunityPlugins = path.join(local, "community-plugins.json");
                    const localAppearance = path.join(local, "appearance.json");
                    const remote = `${oldObsidianOptions.androidVault!}/.obsidian`;
                    const remoteCommunityPlugins = `${remote}/community-plugins.json`;
                    const remoteAppearance = `${remote}/appearance.json`;

                    await appiumDownloadFile(this, remoteCommunityPlugins, localCommunityPlugins).catch(() => {});
                    await appiumDownloadFile(this, remoteAppearance, localAppearance).catch(() => {});
                    await service.obsidianLauncher.setupVault({
                        vault: oldObsidianOptions.openVault!, copy: false,
                        plugins: selectedPlugins, themes: selectedThemes,
                    });
                    let files = [localCommunityPlugins, localAppearance];
                    files = (await Promise.all(files.map(async f => await fileExists(f) ? f : ""))).filter(f => f);
                    await appiumUploadFiles(this, {src: local, dest: remote, files});

                    // switch the app back
                    await navigateAndWait(this, () => location.replace('http://localhost/'));
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
                        vault: oldObsidianOptions.openVault!, copy: false,
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
                await this.appiumSetupApp();
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
        const obsidianOptions = getNormalizedObsidianOptions(browser.requestedCapabilities);

        if (isAppium(cap)) {
            await this.appiumCloseVault();

            for (const file of await appiumReaddir(browser, androidVaultsDir)) {
                if (!file.includes(obsidianOptions.testRunId) || file.endsWith("-copy")) {
                    await browser.execute("mobile: shell", {command: "rm", args: ["-rf", file]});
                }
            }
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
