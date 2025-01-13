import * as fsAsync from "fs/promises"
import type { Capabilities, Options, Services } from '@wdio/types'
import { ObsidianLauncher } from "./obsidianUtils.js"
import browserCommands, { ObsidianBrowserCommands } from "./browserCommands.js"


interface ObsidianServiceOptions {
    /**
     * Directory to cache downloaded Obsidian versions. Defaults to `./.optl`
     */
    cacheDir?: string,

    /**
     * Override the `obsidian-versions.json` used by the service. Can be a URL or a file path.
     * This is only really useful for this package's own internal tests.
     */
    obsidianVersionsFile?: string,
}


interface ObsidianCapabilityOptions {
    /**
     * Version of Obsidian to run. Can be set to "latest", "latest-beta", or a specific version name. Defaults to
     * "latest". You can also use the wdio `browserVersion` option instead.
     */
    appVersion?: string

    /**
     * Version of the Obsidian Installer to download.
     * 
     * Note that Obsidian is distributed in two parts, the "installer", which is the executable containing Electron, and
     * the "app" which is a bundle of JavaScript containing the Obsidian code. Obsidian's self-update system only
     * updates the JavaScript bundle, and not the base installer/Electron version. This makes Obsidian's auto-update
     * fast as it only needs to download a few MiB of JS instead of all of  Electron. But, it means different users with
     * the same Obsidian version may be running on different versions of Electron, which could cause obscure differences
     * in plugin behavior if you are using newer JavaScript features and the like in your plugin.
     * 
     * If passed "latest", it will use the maximum installer version compatible with the selected Obsidian version. If
     * passed "earliest" it will use the oldest installer version compatible with the selected Obsidian version. The 
     * default is "earliest".
     */
    installerVersion?: string,

    /** Path to local plugin to install. */
    plugins?: string[],

    /**
     * The path to the vault to open. The vault will be copied first, so any changes made in your tests won't affect the
     * original. Defaults to an empty vault.
     */
    vault?: string,

    /** Path to the Obsidian binary to use. If omitted it will download Obsidian automatically.*/
    binaryPath?: string,

    /** Path to the app asar to load into obsidian. If omitted it will be downloaded automatically. */
    appPath?: string,
}

declare global {
    namespace WebdriverIO {
        interface Capabilities {
            'wdio:obsidianOptions'?: ObsidianCapabilityOptions,
        }

        interface Browser extends ObsidianBrowserCommands {
            /**
             * Opens an obsidian vault. The vault will be copied, so any changes made in your tests won't be persited to the
             * original. This does require rebooting Obsidian. You can also set the vault in the `wdio.conf.ts` capabilities
             * section which may be useful if all your tests use the same vault.
             * 
             * @param vault path to the vault to open. If omitted it will use the vault set in `wdio.conf.ts` (An empty
             *     vault by default.)
             * @param plugins List of plugins to initialize. If omitted, it will use the plugins set in `wdio.conf.ts`.
             * @returns Returns the new sessionId (same as reloadSession()).
             */
            openVault(vault?: string, plugins?: string[]): Promise<string>;
        }
    }
}



export class ObsidianLauncherService implements Services.ServiceInstance {
    private obsidianLauncher: ObsidianLauncher

    constructor (
        public options: ObsidianServiceOptions,
        public capabilities: WebdriverIO.Capabilities,
        public config: Options.Testrunner
    ) {
        this.obsidianLauncher = new ObsidianLauncher(options.cacheDir, options.obsidianVersionsFile);
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

        await this.obsidianLauncher.downloadVersions();

        for (const cap of obsidianCapabilities) {
            const obsidianOptions = cap['wdio:obsidianOptions'] ?? {};

            const appVersion = cap.browserVersion ?? "latest";
            const installerVersion = obsidianOptions.installerVersion ?? "earliest";

            const {
                appVersionInfo, installerVersionInfo,
            } = await this.obsidianLauncher.resolveVersions(appVersion, installerVersion);

            let installerPath = obsidianOptions.binaryPath;
            if (!installerPath) {
                installerPath = await this.obsidianLauncher.downloadInstaller(installerVersionInfo.version);
            }
            let appPath = obsidianOptions.appPath;
            if (!appPath) {
                appPath = await this.obsidianLauncher.downloadApp(appVersionInfo.version);
            }

            cap.browserName = "chrome";
            cap.browserVersion = installerVersionInfo.chromeVersion;
            cap['wdio:obsidianOptions'] = {
                binaryPath: installerPath,
                appPath: appPath,
                plugins: ["."],
                ...obsidianOptions,
                appVersion: appVersionInfo.version, // Resolve the versions
                installerVersion: installerVersionInfo.version,
            };
            cap['goog:chromeOptions'] = {
                binary: installerPath,
                windowTypes: ["app", "webview"],
                ...cap['goog:chromeOptions'],
            }
            cap["wdio:enforceWebDriverClassic"] = true;
        }
    }
}

export class ObsidianWorkerService implements Services.ServiceInstance {
    private obsidianLauncher: ObsidianLauncher
    private tmpDir: string|undefined

    constructor (
        public options: ObsidianServiceOptions,
        public capabilities: WebdriverIO.Capabilities,
        public config: Options.Testrunner
    ) {
        this.obsidianLauncher = new ObsidianLauncher(options.cacheDir, options.obsidianVersionsFile);
    }

    async beforeSession(config: Options.Testrunner, capabilities: WebdriverIO.Capabilities) {
        const obsidianOptions = capabilities['wdio:obsidianOptions'];

        if (!obsidianOptions) {
            return;
        }

        this.tmpDir = await this.obsidianLauncher.setup(
            obsidianOptions.appPath!, obsidianOptions.vault, obsidianOptions.plugins!,
        );

        capabilities['goog:chromeOptions']!.args = [
            `--user-data-dir=${this.tmpDir}/config`,
            ...(capabilities['goog:chromeOptions']!.args ?? [])
        ];
    }

    async afterSession() {
        if (this.tmpDir) {
            await fsAsync.rm(this.tmpDir, { recursive: true, force: true });
        }
    }

    private async enablePlugins(browser: WebdriverIO.Browser) {
        await browser.execute("await app.plugins.setEnable(true)");
        // close the modal if it was created
        if (await browser.$(".modal.mod-trust-folder").isExisting()) {
            browser.sendKeys(["Escape"]);
        }
    }

    async before(capabilities: WebdriverIO.Capabilities, specs: never, browser: WebdriverIO.Browser) {
        await this.enablePlugins(browser);

        const service = this; // eslint-disable-line @typescript-eslint/no-this-alias
        await browser.addCommand("openVault", async function(this: WebdriverIO.Browser, vault?: string, plugins?: string[]) {
            const appPath = this.requestedCapabilities['wdio:obsidianOptions'].appPath;
            vault = vault ?? this.requestedCapabilities['wdio:obsidianOptions'].vault;
            plugins = plugins ?? this.requestedCapabilities['wdio:obsidianOptions'].plugins;

            const oldTmpDir = service.tmpDir!;
            service.tmpDir = await service.obsidianLauncher.setup(appPath, vault, plugins!)

            console.log(`Opening Obsidian vault ${vault}`);

            const newArgs = [
                `--user-data-dir=${service.tmpDir}/config`,
                ...this.requestedCapabilities['goog:chromeOptions'].args
                    .filter((a: string) => a != `--user-data-dir=${oldTmpDir}/config`),
            ]

            // Reload session already merges with existing settings, and tries to restart the driver entirely if you
            // set browserName explicitly instead of letting it keep existing.
            const sessionId = await this.reloadSession({
                'wdio:obsidianOptions': {
                    ...this.requestedCapabilities['wdio:obsidianOptions'],
                    vault, plugins,
                },
                'goog:chromeOptions': {
                    ...this.requestedCapabilities['goog:chromeOptions'],
                    args: newArgs,
                },
            });
            await service.enablePlugins(browser);

            await fsAsync.rm(oldTmpDir, { recursive: true, force: true });

            return sessionId;
        });

        for (const [name, cmd] of Object.entries(browserCommands)) {
            await browser.addCommand(name, cmd);
        }
    }
}

export default ObsidianWorkerService;
export const launcher = ObsidianLauncherService;
