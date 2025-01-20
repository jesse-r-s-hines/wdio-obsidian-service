import fsAsync from "fs/promises"
import fs from "fs"
import zlib from "zlib"
import path from "path"
import os from "os";
import fetch from "node-fetch"
import extractZip from "extract-zip"
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { downloadArtifact } from '@electron/get';
import { fileExists } from "./utils.js";
import { ObsidianVersionInfo } from "./types.js";
import { fetchObsidianAPI } from "./apis.js";
import ChromeLocalStorage from "./chromeLocalStorage.js";
import _ from "lodash"

/**
 * Installs a plugin into an obsidian vault.
 * @param plugins List plugins paths to install.
 * @param vault Path to the vault to install the plugin in.
 */
export async function installPlugins(vault: string, plugins: string[]) {
    const obsidianDir = path.join(vault, '.obsidian');
    await fsAsync.mkdir(obsidianDir, { recursive: true });
    const pluginIds: string[] = [];

    for (const plugin of plugins) {
        const pluginId = JSON.parse(await fsAsync.readFile(path.join(plugin, 'manifest.json'), 'utf8')).id;
        pluginIds.push(pluginId);
        const pluginDest = path.join(obsidianDir, 'plugins', pluginId);

        if (await fileExists(pluginDest)) {
            await fsAsync.rm(pluginDest, { recursive: true });
        }
        await fsAsync.mkdir(pluginDest, { recursive: true });

        const files = {
            "manifest.json": true,
            "main.js": true,
            "styles.css": false,
            "data.json": false,
        }
        for (const [file, required] of Object.entries(files)) {
            if (required || await fileExists(path.join(plugin, file))) {
                await fsAsync.copyFile(path.join(plugin, file), path.join(pluginDest, file));
            }
        }
    }

    const communityPluginsFile = path.join(obsidianDir, 'community-plugins.json');
    let communityPlugins = [];
    if (await fileExists(communityPluginsFile)) {
        communityPlugins = JSON.parse(await fsAsync.readFile(communityPluginsFile, 'utf-8'));
    }
    communityPlugins = _.uniq([...communityPlugins, ...pluginIds]);
    await fsAsync.writeFile(communityPluginsFile, JSON.stringify(communityPlugins, undefined, 2));
}

/**
 * Handles downloading and setting sandboxed config directories and vaults for Obsidian.
 */
export class ObsidianLauncher {
    readonly cacheDir: string
    readonly obsidianVersionsUrl: string
    private versions: ObsidianVersionInfo[]|undefined

    /**
     * Construct an ObsidianLauncher.
     * @param cacheDir Path to the cache directory. Defaults to OPTL_CACHE or "./.optl"
     * @param obsidianVersionsUrl The `obsidian-versions.json` used by the service. Can be a file URL. 
     *     Defaults to the GitHub repo's obsidian-versions.json.
     */
    constructor(cacheDir?: string, obsidianVersionsUrl?: string) {
        this.cacheDir = path.resolve(cacheDir ?? process.env.OPTL_CACHE ?? "./.optl");
        const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
        const defaultVersionsURL =  path.join(packageDir, "obsidian-versions.json"); // TODO
        this.obsidianVersionsUrl = obsidianVersionsUrl ?? defaultVersionsURL;
    }

    /**
     * Downloads the obsidian-versions.json file. Should be called before getVersions() if its not already
     * downloaded.
     */
    async downloadVersions(): Promise<void> {
        await fsAsync.mkdir(this.cacheDir, { recursive: true });
        const dest = path.join(this.cacheDir, "obsidian-versions.json");

        let fileContents: string
        if (this.obsidianVersionsUrl.startsWith("file://")) {
            fileContents = await fsAsync.readFile(fileURLToPath(this.obsidianVersionsUrl), 'utf-8');
        } else {
            try {
                fileContents = await fetch(this.obsidianVersionsUrl).then(r => r.text());
            } catch (e) {
                if (await fileExists(dest)) {
                    console.warn("Unable to download obsidian-versions.json, using cached file.");
                    return
                } else {
                    throw e;
                }
            }
        }

        this.versions = JSON.parse(fileContents).versions;
        await fsAsync.writeFile(path.join(this.cacheDir, "obsidian-versions.json"), fileContents);
    }

    /**
     * Get information about all available Obsidian versions.
     * This just loads it from the cache, you'll need to call downloadObsidian() first to actually download it.
     */
    async getVersions(): Promise<ObsidianVersionInfo[]> {
        if (!this.versions) {
            const filePath = path.join(this.cacheDir, "obsidian-versions.json");
            this.versions = JSON.parse(await fsAsync.readFile(filePath, 'utf-8')).versions;
        }
        return this.versions!;
    }

    /**
     * Resolves version strings to ObsidianVersionInfo objects.
     * @param appVersion Obsidian version string or "latest" or "latest-beta"
     * @param installerVersion Obsidian version string or "latest" or "earliest"
     * @returns 
     */
    async resolveVersions(appVersion: string, installerVersion: string) {
        const versions = await this.getVersions();

        if (appVersion == "latest") {
            appVersion = versions.filter(v => !v.isBeta).at(-1)!.version;
        } else if (appVersion == "latest-beta") {
            appVersion = versions.at(-1)!.version;
        } else {
            appVersion = appVersion.replace(/^v/, ''); // remove v if present.
        }
        const appVersionInfo = versions.find(v => v.version == appVersion);
        if (!appVersionInfo) {
            throw Error(`No Obsidian version ${appVersion} found`);
        }

        if (installerVersion == "latest") {
            installerVersion = appVersionInfo.maxInstallerVersion;
        } else if (installerVersion == "earliest") {
            installerVersion = appVersionInfo.minInstallerVersion;
        } else {
            installerVersion = installerVersion.replace(/^v/, '');
        }
        const installerVersionInfo = versions.find(v => v.version == installerVersion);
        if (!installerVersionInfo || !installerVersionInfo.chromeVersion) {
            throw Error(`No Obsidian installer for version ${installerVersion} found`);
        }

        return { appVersionInfo, installerVersionInfo };
    }

    /**
     * Downloads the Obsidian installer for the given version and platform. Returns the file path.
     * @param installerVersion Version to download. Should be an actual version, not a string like "latest" etc.
     */
    async downloadInstaller(installerVersion: string): Promise<string> {
        const installerVersionInfo = (await this.getVersions()).find(v => v.version == installerVersion)!;
        const installerUrl = installerVersionInfo.downloads.appImage;
        if (!installerUrl) {
            throw Error(`No linux AppImage found for Obsidian version ${installerVersion}`);
        }
        const installerPath = path.join(this.cacheDir, "obsidian-installer", installerUrl.split("/").at(-1)!);

        if (!(await fileExists(installerPath))) {
            console.log(`Downloading Obsidian installer v${installerVersion}...`)
            await fsAsync.mkdir(path.dirname(installerPath), { recursive: true });
            await fsAsync.rm(`${installerPath}.tmp`, { force: true });
            await fsAsync.writeFile(`${installerPath}.tmp`, (await fetch(installerUrl)).body as any);
            await fsAsync.chmod(`${installerPath}.tmp`, 0o755);
            await fsAsync.rename(`${installerPath}.tmp`, installerPath);
        }

        return installerPath;
    }

    /**
     * Downloads the Obsidian asar for the given version and platform. Returns the file path.
     * @param appVersion Version to download. Should be an actual version, not a string like "latest" etc.
     */
    async downloadApp(appVersion: string): Promise<string> {
        const appVersionInfo = (await this.getVersions()).find(v => v.version == appVersion)!;
        const appUrl = appVersionInfo.downloads.asar;
        if (!appUrl) {
            throw Error(`No asar found for Obsidian version ${appVersion}`);
        }
        const appPath = path.join(this.cacheDir, 'obsidian-app', appUrl.split("/").at(-1)!.replace(/\.gz$/, ''));

        if (!(await fileExists(appPath))) {
            console.log(`Downloading Obsidian app v${appVersion}...`)
            await fsAsync.mkdir(path.dirname(appPath), { recursive: true });
            await fsAsync.rm(`${appPath}.tmp`, { force: true });
            await fsAsync.rm(`${appPath}.gz`, { force: true });

            const isInsidersBuild = new URL(appUrl).hostname.endsWith('.obsidian.md');
            const response = isInsidersBuild ? await fetchObsidianAPI(appUrl) : await fetch(appUrl);

            await fsAsync.writeFile(`${appPath}.gz`, response.body as any);
            await pipeline(
                fs.createReadStream(`${appPath}.gz`),
                zlib.createGunzip(),
                fs.createWriteStream(`${appPath}.tmp`,),
            );
            await fsAsync.rm(appPath + ".gz");
            await fsAsync.rename(`${appPath}.tmp`, appPath);
        }

        return appPath;
    }

    /**
     * Downloads chromedriver for the given Obsidian version.
     * 
     * wdio will download chromedriver from the Chrome for Testing API automatically (see
     * https://github.com/GoogleChromeLabs/chrome-for-testing#json-api-endpoints). However, Google has only put
     * chromedriver since v115.0.5763.0 in that API, so wdio can't download older versions of chromedriver. As of
     * Obsidian v1.7.7, minInstallerVersion is v0.14.5 which runs on chromium v100.0.4896.75. Here we download
     * chromedriver for older versions ourselves using the @electron/get package which fetches it from
     * https://github.com/electron/electron/releases.
     */
    async downloadChromedriver(installerVersion: string): Promise<string> {
        const versionInfo = (await this.getVersions()).find(v => v.version == installerVersion)!;
        const electronVersion = versionInfo.electronVersion;
        if (!electronVersion) {
            throw Error(`${installerVersion} is not an Obsidian installer version.`)
        }

        const chromedriverZipPath = await downloadArtifact({
            version: electronVersion,
            artifactName: 'chromedriver',
            cacheRoot: path.join(this.cacheDir, "chromedriver-legacy"),
            unsafelyDisableChecksums: true, // the checksums are slow and run even on cache hit.
        });
        const chromedriverPath = path.join(path.dirname(chromedriverZipPath), "chromedriver");

        if (!(await fileExists(chromedriverPath))) {
            console.log(`Downloaded legacy chromedriver for electron ${electronVersion}`)
            const extractPath = path.join(path.dirname(chromedriverZipPath), 'extract');
            await fsAsync.rm(extractPath, { recursive: true, force: true }); // if it exists from a previous failure
            await extractZip(chromedriverZipPath, { dir: extractPath });
            await fsAsync.rename(path.join(extractPath, 'chromedriver'), chromedriverPath);
            await fsAsync.rm(extractPath, { recursive: true });
        }

        return chromedriverPath;
    }

    /**
     * Setups the vault and config dir to use for the --user-data-dir in obsidian. Returns the path to the created 
     * temporary directory, which will contain two sub directories, "config" and "vault".
     *
     * @param appVersion Obsidian version string. Should be an actual version, not a string like "latest" etc.
     * @param installerVersion Obsidian version string. Should be an actual version, not a string like "latest" etc.
     * @param appPath Path to the asar file to install.
     * @param vault Path to the vault to open in Obsidian. Won't open a vault if left undefined.
     * @param plugins List of plugins to install in the vault.
     */
    async setup(params: {
        appVersion: string, installerVersion: string,
        appPath: string, vault?: string, plugins?: string[],
    }): Promise<string> {
        const tmpDir = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'optl-'));
        // configDir will be passed to --user-data-dir, so Obsidian is somewhat sandboxed. We set up "obsidian.json" so
        // that Obsidian opens the vault by default and doesn't check for updates.
        const configDir = path.join(tmpDir, 'config');
        await fsAsync.mkdir(configDir);

        let obsidianJson: any = {
            updateDisabled: true, // Prevents Obsidian trying to auto-update on boot.
        }
        let localStorageData: Record<string, string> = {
            "most-recently-installed-version": params.appVersion, // prevents the changelog page on boot
        }

        if (params.vault !== undefined) {
            const vaultCopy = path.join(tmpDir, 'vault');
            // Copy the vault folder so it isn't modified, and add the plugins to it.
            await fsAsync.cp(params.vault, vaultCopy, { recursive: true });
            await installPlugins(vaultCopy, params.plugins ?? []);

            const vaultId = "1234567890abcdef";
            obsidianJson = {
                ...obsidianJson,
                vaults: {
                    [vaultId]: {
                        path: path.resolve(vaultCopy),
                        ts: new Date().getTime(),
                        open: true,
                    },
                },
            };
            localStorageData = {
                ...localStorageData,
                [`enable-plugin-${vaultId}`]: "true", // Disable "safe mode" and enable plugins
            }
        }

        await fsAsync.writeFile(path.join(configDir, 'obsidian.json'), JSON.stringify(obsidianJson));
        // Create hardlink for the asar so Obsidian picks it up.
        await fsAsync.link(params.appPath, path.join(configDir, path.basename(params.appPath)));
        const localStorage = new ChromeLocalStorage(configDir);
        await localStorage.setItems("app://obsidian.md", localStorageData)
        await localStorage.close();

        return tmpDir;
    }
}
