import * as fsAsync from "fs/promises"
import * as fs from "fs"
import * as zlib from "zlib"
import * as path from "path"
import * as os from "os";
import fetch from "node-fetch"
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { fileExists } from "./utils.js";
import { ObsidianVersionInfo } from "./types.js";
import { fetchObsidianAPI } from "./apis.js";
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
    readonly obsidianVersionsFile: string
    private versions: ObsidianVersionInfo[]|undefined

    /**
     * Construct an ObsidianLauncher.
     * @param cacheDir Path to the cache directory. Defaults to OPTL_CACHE or "./.optl"
     * @param obsidianVersionsFile The `obsidian-versions.json` used by the service. Can be a URL or a file path. 
     *     Defaults to the GitHub repo's obsidian-versions.json.
     */
    constructor(cacheDir?: string, obsidianVersionsFile?: string) {
        this.cacheDir = path.resolve(cacheDir ?? process.env.OPTL_CACHE ?? "./.optl");
        const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
        const defaultVersionsURL =  path.join(packageDir, "obsidian-versions.json"); // TODO
        this.obsidianVersionsFile = obsidianVersionsFile ?? defaultVersionsURL;
    }

    /**
     * Downloads the obsidian-versions.json file. Should be called before getVersions() if its not already
     * downloaded.
     */
    async downloadVersions(): Promise<void> {
        await fsAsync.mkdir(this.cacheDir, { recursive: true });
        const dest = path.join(this.cacheDir, "obsidian-versions.json");

        let fileContents: string
        if (this.obsidianVersionsFile.startsWith("/") || this.obsidianVersionsFile.startsWith('.')) {
            fileContents = await fsAsync.readFile(this.obsidianVersionsFile, 'utf-8');
        } else {
            try {
                fileContents = await fetch(this.obsidianVersionsFile).then(r => r.text());
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
     * installerVersion should be an actual version, not a string like "latest" etc.
     */
    async downloadInstaller(installerVersion: string): Promise<string> {
        const installerVersionInfo = (await this.getVersions()).find(v => v.version == installerVersion)!;
        await fsAsync.mkdir(this.cacheDir, { recursive: true });

        const installerUrl = installerVersionInfo.downloads.appImage!;
        const installerPath = path.join(this.cacheDir, installerUrl.split("/").at(-1)!);

        if (!(await fileExists(installerPath))) {
            console.log("Downloading Obsidian installer...")
            await fsAsync.writeFile(installerPath, (await fetch(installerUrl)).body as any);
            await fsAsync.chmod(installerPath, 0o755);
        }

        return installerPath;
    }

    /**
     * Downloads the Obsidian asar for the given version and platform. Returns the file path.
     * appVersion should be an actual version, not a string like "latest" etc.
     */
    async downloadApp(appVersion: string): Promise<string> {
        const appVersionInfo = (await this.getVersions()).find(v => v.version == appVersion)!;
        await fsAsync.mkdir(this.cacheDir, { recursive: true });

        const appUrl = appVersionInfo.downloads.asar!
        const appPath = path.join(this.cacheDir, appUrl.split("/").at(-1)!.replace(/\.gz$/, ''));

        if (!(await fileExists(appPath))) {
            console.log("Downloading Obsidian app...")
            const isInsidersBuild = new URL(appUrl).hostname.endsWith('.obsidian.md');
            const response = isInsidersBuild ? await fetchObsidianAPI(appUrl) : await fetch(appUrl);

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

    /**
     * Setups the vault and config dir to use for the --user-data-dir in obsidian. Returns the path to the created 
     * temporary directory, which will contain two sub directories, "config" and "vault".
     *
     * @param appPath Path to the asar file to install.
     * @param vault Path to the vault to open in Obsidian. Will create an empty vault if undefined.
     * @param plugins List of plugins to install in the vault.
     */
    async setup(appPath: string, vault: string|undefined, plugins: string[]): Promise<string> {
        const tmpDir = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'optl-'));

        const vaultCopy = path.join(tmpDir, 'vault');
        // Copy the vault folder so it isn't modified, and add the plugin to it.
        if (vault != undefined) {
            await fsAsync.cp(vault, vaultCopy, { recursive: true });
        } else {
            await fsAsync.mkdir(vaultCopy);
        }
        await installPlugins(vaultCopy, plugins);

        const configDir = path.join(tmpDir, 'config');
        // configDir will be passed to --user-data-dir, so Obsidian is somewhat sandboxed. We set up "obsidian.json" so
        // that Obsidian opens the vault by default.
        const obsidianConfigFile = {
            updateDisabled: true, // Prevents Obsidian trying to auto-update on boot.
            vaults: {
                "1234567890abcdef": {
                    path: path.resolve(vaultCopy),
                    ts: new Date().getTime(),
                    open: true,
                },
            },
        };
        await fsAsync.mkdir(configDir);
        await fsAsync.writeFile(path.join(configDir, 'obsidian.json'), JSON.stringify(obsidianConfigFile));
        // Create hardlink for the asar so Obsidian picks it up.
        await fsAsync.link(appPath, path.join(configDir, path.basename(appPath)));

        return tmpDir;
    }
}
