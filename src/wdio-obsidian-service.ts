import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import * as fsAsync from "fs/promises"
import * as zlib from "zlib"
import fetch from "node-fetch";
import type { Capabilities, Options, Services } from '@wdio/types'
import { fileExists } from "./utils.js";
import { ObsidianLauncher } from "./obsidianUtils.js"
import _ from "lodash"


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
     * Version of the Obsidian Installer to download.
     * 
     * Note that Obsidian is distributed in  two parts, the "installer", which is the executable containing Electron,
     * and the "app" which is a bundle of JavaScript containing the Obsidian code. Obsidian's self-update system only
     * updates the JavaScript bundle, and not the base installer/Electron version. This makes Obsidian's auto-update
     * fast as it only needs to download a few MiB of JS instead of all of  Electron. But, it means different users with
     * the same Obsidian version may be running on different versions of Electron, which could cause obscure differences
     * in plugin behavior if you are using newer JavaScript features and the like in your plugin. You can specify the
     * installerVersion you want to test with separately here.
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
                installerVersion,
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

    /**
     * Gets executed just before initializing the webdriver session and test framework. It allows you
     * to manipulate configurations depending on the capability or spec.
     * @param {object} config wdio configuration object
     * @param {Array.<Object>} capabilities list of capabilities details
     * @param {Array.<String>} specs List of spec file paths that are to be run
     * @param {string} cid worker id (e.g. 0-0)
     */
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

    /**
     * Gets executed right after terminating the webdriver session.
     * @param {object} config wdio configuration object
     * @param {Array.<Object>} capabilities list of capabilities details
     * @param {Array.<String>} specs List of spec file paths that ran
     */
    async afterSession(config: any, capabilities: WebdriverIO.Capabilities) {
        if (this.tmpDir) {
            await fsAsync.rm(this.tmpDir, { recursive: true, force: true });
        }
    }

    async before(capabilities: WebdriverIO.Capabilities, specs: never, browser: any) {
        await browser.execute("await app.plugins.setEnable(true)");
        // close the modal if it was created
        if (await browser.$(".modal.mod-trust-folder").isExisting()) {
            browser.sendKeys(["Escape"]);
        }
    }
}

export default ObsidianWorkerService;
export const launcher = ObsidianLauncherService;
