import { fileURLToPath } from "url"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import * as fsAsync from "fs/promises"
import * as zlib from "zlib"
import * as crypto from "crypto";
import { pipeline } from "stream/promises";
import type { Capabilities, Options, Services } from '@wdio/types'
import type { ObsidianVersionInfo } from "./types.js";
import { fileExists } from "./utils.js";
import { fetchObsidianAPI } from "./apis.js"
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
     * installerVersion you want to test with separately here. By default, it is set to the same as `version`.
     * 
     * If passed "latest", it will use the maximum installer version compatible with the selected Obsidian version. If
     * passed "earliest" it will use the oldest installer version compatible with the selected Obsidian version.
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
    asarPath?: string,
}


declare global {
    namespace WebdriverIO {
        interface Capabilities {
            'wdio:obsidianOptions'?: ObsidianCapabilityOptions,
        }
    }
}


/** Installs a plugin into a vault by copying the files over */
async function installPlugin(plugin: string, vault: string) {
    const pluginId = JSON.parse(await fsAsync.readFile(path.join(plugin, 'manifest.json'), 'utf8')).id;
    const obsidianDir = path.join(vault, '.obsidian')
    const pluginDir = path.join(obsidianDir, 'plugins', pluginId);

    await fsAsync.mkdir(pluginDir, { recursive: true });
    await fsAsync.copyFile(path.join(plugin, 'manifest.json'), path.join(pluginDir, 'manifest.json'))
    await fsAsync.copyFile(path.join(plugin, 'main.js'), path.join(pluginDir, 'main.js'))
    if (await fileExists(path.join(plugin, 'styles.css'))) {
        await fsAsync.copyFile(path.join(plugin, 'styles.css'), path.join(pluginDir, 'styles.css'))
    }

    let communityPlugins = [];
    if (await fileExists(path.join(obsidianDir, 'community-plugins.json'))) {
        communityPlugins = JSON.parse(await fsAsync.readFile(path.join(obsidianDir, 'community-plugins.json'), 'utf-8'));
    }
    if (!communityPlugins.includes(pluginId)) {
        communityPlugins = [...communityPlugins, pluginId];
        await fsAsync.writeFile(
            path.join(obsidianDir, 'community-plugins.json'),
            JSON.stringify(communityPlugins, undefined, 2),
        );
    }
}



export class ObsidianLauncherService implements Services.ServiceInstance {
    private cache: string

    constructor (
        public options: ObsidianServiceOptions,
        public capabilities: WebdriverIO.Capabilities,
        public config: Options.Testrunner
    ) {
        this.cache = options.cacheDir ?? path.resolve("./.optl");
    }

    /** Get information about all available Obsidian versions. */
    private async getObsidianVersions(): Promise<ObsidianVersionInfo[]> {
        const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
        const defaultUrl =  path.join(packageDir, "obsidian-versions.json"); // TODO
        const urlOrPath = this.options.obsidianVersionsFile ?? defaultUrl;

        let fileContents: string
        if (urlOrPath.startsWith("/") || urlOrPath.startsWith('.')) {
            fileContents = await fsAsync.readFile(urlOrPath, 'utf-8')
        } else {
            fileContents = await fetch(urlOrPath).then(r => r.text())
        }
        return JSON.parse(fileContents).versions;
    }

    private async downloadObsidianInstaller(url: string) {
        const installerPath = path.join(this.cache, url.split("/").at(-1)!);

        if (!(await fileExists(this.cache))) {
            await fsAsync.mkdir(this.cache, { recursive: true });
        }

        if (!(await fileExists(installerPath))) {
            console.log("Downloading Obsidian installer...")
            await fsAsync.writeFile(installerPath, (await fetch(url)).body as any);
            await fsAsync.chmod(installerPath, 0o755);
        }

        return installerPath;
    }

    private async downloadObsidianAsar(url: string) {
        const appPath = path.join(this.cache, url.split("/").at(-1)!);

        if (!(await fileExists(this.cache))) {
            await fsAsync.mkdir(this.cache, { recursive: true });
        }

        if (!(await fileExists(appPath))) {
            console.log("Downloading Obsidian app...")
            const isInsidersBuild = new URL(url).hostname.endsWith('.obsidian.md');
            const response = isInsidersBuild ? await fetchObsidianAPI(url) : await fetch(url);

            await fsAsync.writeFile(appPath + ".gz", response.body as any);
            await pipeline(
                fs.createReadStream(appPath + ".gz"),
                zlib.createGunzip(),
                fs.createWriteStream(appPath),
            );
            await fsAsync.rm(appPath + ".gz");
        }

        return appPath;
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

        const versions = await this.getObsidianVersions();

        for (const cap of obsidianCapabilities) {
            const obsidianOptions = cap['wdio:obsidianOptions'] ?? {};

            let appVersion = cap.browserVersion ?? "latest";
            if (appVersion == "latest") {
                appVersion = versions.filter(v => !v.isBeta).at(-1)!.version;
            } else if (appVersion == "latest-beta") {
                appVersion = versions.at(-1)!.version;
            }
            const appVersionInfo = versions.find(v => v.version == appVersion);
            if (!appVersionInfo) {
                throw Error(`No Obsidian version ${appVersion} found`);
            }

            let installerVersion = obsidianOptions.installerVersion ?? "latest";
            if (installerVersion == "latest") {
                installerVersion = appVersionInfo.maxInstallerVersion;
            } else if (installerVersion == "earliest") {
                installerVersion = appVersionInfo.minInstallerVersion;
            }
            const installerVersionInfo = versions.find(v => v.version == installerVersion);
            if (!installerVersionInfo || !installerVersionInfo.chromeVersion) {
                throw Error(`No Obsidian installer for version ${installerVersion} found`);
            }

            const chromeVersion = installerVersionInfo.chromeVersion;

            let installerPath = obsidianOptions.binaryPath;
            if (!installerPath) {
                installerPath = await this.downloadObsidianInstaller(installerVersionInfo.downloads.appImage!);
            }
            let asarPath = obsidianOptions.asarPath;
            if (!asarPath) {
                asarPath = await this.downloadObsidianAsar(appVersionInfo.downloads.asar!);
            }

            cap.browserName = "chrome";
            cap.browserVersion = chromeVersion;
            cap['wdio:obsidianOptions'] = {
                binaryPath: installerPath,
                asarPath: asarPath,
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
    private tmpDir: string

    constructor (
        public options: ObsidianServiceOptions,
        public capabilities: WebdriverIO.Capabilities,
        public config: Options.Testrunner
    ) {
        const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
        this.tmpDir = path.join(os.tmpdir(), `optl-${suffix}`);
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
        if (!capabilities['wdio:obsidianOptions']) {
            return // We assigned obsidianOptions in onPrepare
        }
        const obsidianOptions = capabilities['wdio:obsidianOptions']

        const configDir = path.join(this.tmpDir, 'obsidian-config');
        const vaultCopy = path.join(this.tmpDir, 'vault');

        // We've sandboxed the obsidian config/user data directory for the tests.
        // Here we setup the initial `obsidian.json` file so that obsidian automatically opens the vault we want.
        await fsAsync.mkdir(configDir, { recursive: true });
        const obsidianConfigFile = {
            updateDisabled: true,
            vaults: {
                "1234567890abcdef": {
                    path: path.resolve(vaultCopy),
                    ts: new Date().getTime(),
                    open: true,
                },
            },
        }
        await fsAsync.writeFile(path.join(configDir, 'obsidian.json'), JSON.stringify(obsidianConfigFile));
        await fsAsync.copyFile(
            path.join(obsidianOptions.asarPath!),
            path.join(configDir, path.basename(obsidianOptions.asarPath!))
        );

        // Copy the vault folder so it isn't modified, and add the plugin to it.
        if (obsidianOptions.vault) {
            await fsAsync.cp(obsidianOptions.vault!, vaultCopy, { recursive: true });
            await fsAsync.rm(path.join(vaultCopy, '.obsidian/plugins'), { recursive: true, force: true });
        } else {
            await fsAsync.mkdir(vaultCopy);
        }
        for (const plugin of obsidianOptions.plugins!) {
            await installPlugin(plugin, vaultCopy);
        }


        capabilities['goog:chromeOptions'] = {
            ...capabilities['goog:chromeOptions'],
            args: [
                `--user-data-dir=${configDir}`,
                ...(capabilities['goog:chromeOptions']?.args ?? []),
            ],
        };
    }

    /**
     * Gets executed right after terminating the webdriver session.
     * @param {object} config wdio configuration object
     * @param {Array.<Object>} capabilities list of capabilities details
     * @param {Array.<String>} specs List of spec file paths that ran
     */
    async afterSession(config: any, capabilities: WebdriverIO.Capabilities) {
        await fsAsync.rm(this.tmpDir, { recursive: true, force: true });
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
