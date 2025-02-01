import fsAsync from "fs/promises"
import fs from "fs"
import zlib from "zlib"
import path from "path"
import os from "os";
import fetch from "node-fetch"
import extractZip from "extract-zip"
import { pipeline } from "stream/promises";
import { fileURLToPath, pathToFileURL } from "url";
import { downloadArtifact } from '@electron/get';
import { promisify } from "util";
import child_process from "child_process"
import which from "which"
import semver from "semver"
import { fileExists, withTmpDir, linkOrCp } from "./utils.js";
import { ObsidianVersionInfo, PluginEntry, LocalPluginEntry } from "./types.js";
import { fetchObsidianAPI, fetchWithFileUrl } from "./apis.js";
import ChromeLocalStorage from "./chromeLocalStorage.js";
import _ from "lodash"
const execFile = promisify(child_process.execFile);


/**
 * Installs plugins into an obsidian vault.
 * @param vault Path to the vault to install the plugin in.
 * @param plugins List plugins paths to install.
 */
export async function installPlugins(vault: string, plugins: LocalPluginEntry[]) {
    const obsidianDir = path.join(vault, '.obsidian');
    await fsAsync.mkdir(obsidianDir, { recursive: true });

    const enabledPluginsPath = path.join(obsidianDir, 'community-plugins.json');
    let enabledPlugins: string[] = [];
    if (await fileExists(enabledPluginsPath)) {
        enabledPlugins = JSON.parse(await fsAsync.readFile(enabledPluginsPath, 'utf-8'));
    }

    for (const {path: pluginPath, enabled = true} of plugins) {
        const manifestPath = path.join(pluginPath, 'manifest.json');
        const pluginId = JSON.parse(await fsAsync.readFile(manifestPath, 'utf8').catch(e => "{}")).id;
        if (!pluginId) {
            throw Error(`${pluginPath}/manifest.json missing or malformed.`);
        }

        const pluginDest = path.join(obsidianDir, 'plugins', pluginId);
        await fsAsync.rm(pluginDest, { recursive: true, force: true });
        await fsAsync.mkdir(pluginDest, { recursive: true });

        const files = {
            "manifest.json": true, "main.js": true,
            "styles.css": false, "data.json": false,
        }
        for (const [file, required] of Object.entries(files)) {
            if (await fileExists(path.join(pluginPath, file))) {
                await linkOrCp(path.join(pluginPath, file), path.join(pluginDest, file));
            } else if (required) {
                throw Error(`${pluginPath}/${file} missing.`);
            }
        }

        const pluginAlreadyListed = enabledPlugins.includes(pluginId);
        if (enabled && !pluginAlreadyListed) {
            enabledPlugins.push(pluginId)
        } else if (!enabled && pluginAlreadyListed) {
            enabledPlugins = enabledPlugins.filter(p => p != pluginId);
        }
    }

    await fsAsync.writeFile(enabledPluginsPath, JSON.stringify(enabledPlugins, undefined, 2));
}


/**
 * Obsidian appears to use NSIS to bundle their Window's installers. We want to extract the executable
 * files directly without running the installer. 7zip can extract the raw files from the exe.
 */
export async function extractObsidianExe(exe: string, appArch: string, dest: string) {
    const path7z = await which("7z", { nothrow: true });
    if (!path7z) {
        throw new Error(
            "Downloading Obsidian for Windows requires 7zip to be installed and available on the PATH. " +
            "You install it from https://www.7-zip.org and then add the install location to the PATH."
        );
    }
    exe = path.resolve(exe);
    // The installer contains several `.7z` files with files for different architectures 
    const subArchive = path.join('$PLUGINSDIR', appArch + ".7z");
    dest = path.resolve(dest);

    await withTmpDir(dest, async (tmpDir) => {
        const extractedInstaller = path.join(tmpDir, "installer");
        await execFile(path7z, ["x", "-o" + extractedInstaller, exe, subArchive]);
        const extractedObsidian = path.join(tmpDir, "obsidian");
        await execFile(path7z, ["x", "-o" + extractedObsidian, path.join(extractedInstaller, subArchive)]);
        return extractedObsidian;
    })
}


/**
 * Extract the executables from the Obsidian dmg installer.
 * TODO: This currently isn't used, need to add Mac support.
 */
export async function extractObsidianDmg(dmg: string, dest: string) {
    // TODO: is there a way to extract dmg without requiring 7z?
    const path7z = await which("7z", { nothrow: true });
    if (!path7z) {
        throw new Error(
            "Downloading Obsidian for Mac requires 7zip to be installed and available on the PATH. " +
            "You install it from https://www.7-zip.org and then add the install location to the PATH."
        );
    }
    dmg = path.resolve(dmg);
    dest = path.resolve(dest);

    await withTmpDir(dest, async (tmpDir) => {
        await execFile(path7z, ["x", "-o" + tmpDir, dmg, "*/Obsidian.app"]);
        const universal = path.join(tmpDir, (await fsAsync.readdir(tmpDir))[0]) // e.g. "Obsidian 1.8.4-universal"
        return path.join(universal, "Obsidian.app")
    })
}


/**
 * Handles downloading and setting sandboxed config directories and vaults for Obsidian.
 */
export class ObsidianLauncher {
    readonly cacheDir: string
    readonly versionsUrl: string
    private versions: ObsidianVersionInfo[]|undefined
    readonly communityPluginsUrl: string
    private communityPlugins: any[]|undefined

    /**
     * Construct an ObsidianLauncher.
     * @param cacheDir Path to the cache directory. Defaults to OPTL_CACHE or "./.optl"
     * @param versionsUrl The `obsidian-versions.json` used by the service. Can be a file URL.
     * @param communityPluginsUrl The `community-plugins.json` list to use. Can be a file URL.
     */
    constructor(options: {cacheDir?: string, versionsUrl?: string, communityPluginsUrl?: string}) {
        this.cacheDir = path.resolve(options.cacheDir ?? process.env.OPTL_CACHE ?? "./.optl");
        const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
        const defaultVersionsUrl =  pathToFileURL(path.join(packageDir, "obsidian-versions.json")).toString(); // TODO
        this.versionsUrl = options.versionsUrl ?? defaultVersionsUrl;
        const defaultCommunityPluginsUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";
        this.communityPluginsUrl = options.communityPluginsUrl ?? defaultCommunityPluginsUrl;
    }

    /** Tries downloading url to dest under cache, only warns on errors if the file already exists. */
    private async tryDownload(url: string, dest: string) {
        let fileContent: string|undefined;
        try {
            fileContent = await fetchWithFileUrl(url);
        } catch (e) {
            if (await fileExists(path.join(this.cacheDir, dest))) {
                console.warn(`Unable to download ${dest}, using cached file.`);
            } else {
                throw e;
            }
        }
        if (fileContent) {
            await fsAsync.writeFile(path.join(this.cacheDir, dest), fileContent);
        }
    }

    async downloadMetadata(): Promise<void> {
        await fsAsync.mkdir(this.cacheDir, { recursive: true });
        await this.tryDownload(this.versionsUrl, "obsidian-versions.json");
        await this.tryDownload(this.communityPluginsUrl, "obsidian-community-plugins.json");
    }

    /**
     * Get information about all available Obsidian versions.
     * This just loads it from the cache, you'll need to call downloadMetadata() first to actually download it.
     */
    async getVersions(): Promise<ObsidianVersionInfo[]> {
        if (!this.versions) {
            const filePath = path.join(this.cacheDir, "obsidian-versions.json");
            this.versions = JSON.parse(await fsAsync.readFile(filePath, 'utf-8')).versions;
        }
        return this.versions!;
    }

    /**
     * Get information about all available community plugins.
     * This just loads it from the cache, you'll need to call downloadMetadata() first to actually download it.
     */
    async getCommunityPlugins(): Promise<any[]> {
        if (!this.communityPlugins) {
            const filePath = path.join(this.cacheDir, "obsidian-community-plugins.json");
            this.communityPlugins = JSON.parse(await fsAsync.readFile(filePath, 'utf-8'));
        }
        return this.communityPlugins!
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
            // if invalid match won't be found and we'll throw error below
            appVersion = semver.valid(appVersion) ?? appVersion;
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
            installerVersion = semver.valid(installerVersion) ?? installerVersion;
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
        const {platform, arch} = process;
        const cacheDir = path.join(this.cacheDir, "obsidian-installer", `${platform}-${arch}`);
        
        let installerPath: string
        let downloader: (() => Promise<void>)|undefined
        
        if (platform == "linux") {
            installerPath = path.join(cacheDir, `Obsidian-${installerVersion}.AppImage`)
            let installerUrl: string|undefined
            if (arch.startsWith("arm")) {
                installerUrl = installerVersionInfo.downloads.appImageArm;
            } else {
                installerUrl = installerVersionInfo.downloads.appImage;
            }
            if (installerUrl) {
                downloader = async () => {
                    await withTmpDir(installerPath, async (tmpDir) => {
                        const appImage = path.join(tmpDir, "Obsidian.AppImage");
                        await fsAsync.writeFile(appImage, (await fetch(installerUrl)).body as any);
                        await fsAsync.chmod(appImage, 0o755);
                        return appImage;
                    });
                };
            }
        } else if (platform == "win32") {
            installerPath = path.join(cacheDir, `Obsidian-${installerVersion}`, "Obsidian.exe")
            let installerUrl = installerVersionInfo.downloads.exe;
            let appArch: string|undefined
            if (arch == "x64") {
                appArch = "app-64"
            } else if (arch == "ia32") {
                appArch = "app-32"
            } else if (arch.startsWith("arm")) {
                appArch = "app-arm64"
            }
            if (installerUrl && appArch) {
                downloader = async () => {
                    await withTmpDir(path.dirname(installerPath), async (tmpDir) => {
                        const installerExecutable = path.join(tmpDir, "Obsidian.exe");
                        await fsAsync.writeFile(installerExecutable, (await fetch(installerUrl)).body as any);
                        const obsidianFolder = path.join(tmpDir, "Obsidian");
                        await extractObsidianExe(installerExecutable, appArch, obsidianFolder);
                        return obsidianFolder;
                    });
                };
            }
        } else {
            throw Error(`Unsupported platform ${platform}`);
        }
        if (!downloader) {
            throw Error(`No Obsidian download available for v${installerVersion} ${platform} ${arch}`);
        }

        if (!(await fileExists(installerPath))) {
            console.log(`Downloading Obsidian installer v${installerVersion}...`)
            await fsAsync.mkdir(cacheDir, { recursive: true });
            await downloader();
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
            console.log(`Downloading Obsidian app v${appVersion} ...`)
            await fsAsync.mkdir(path.dirname(appPath), { recursive: true });

            await withTmpDir(appPath, async (tmpDir) => {
                const isInsidersBuild = new URL(appUrl).hostname.endsWith('.obsidian.md');
                const response = isInsidersBuild ? await fetchObsidianAPI(appUrl) : await fetch(appUrl);
                const archive = path.join(tmpDir, 'app.asar.gz');
                const asar = path.join(tmpDir, 'app.asar')
                await fsAsync.writeFile(archive, response.body as any);
                await pipeline(fs.createReadStream(archive), zlib.createGunzip(), fs.createWriteStream(asar));
                return asar;
            })
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

        let chromedriverPath: string
        if (process.platform == "win32") {
            chromedriverPath = path.join(path.dirname(chromedriverZipPath), "chromedriver.exe");
        } else {
            chromedriverPath = path.join(path.dirname(chromedriverZipPath), "chromedriver");
        }

        if (!(await fileExists(chromedriverPath))) {
            console.log(`Downloading legacy chromedriver for electron ${electronVersion} ...`)
            await withTmpDir(chromedriverPath, async (tmpDir) => {
                await extractZip(chromedriverZipPath, { dir: tmpDir });
                return path.join(tmpDir, path.basename(chromedriverPath));
            })
        }

        return chromedriverPath;
    }

    /**
     * Downloads a plugin from a GitHub repo
     * @param repo Repo
     * @param version Version of the plugin to install, or "latest"
     * @returns path to the downloaded plugin
     */
    async downloadGitHubPlugin(repo: string, version = "latest"): Promise<string> {
        let pluginDir = path.join(this.cacheDir, "obsidian-plugins", repo);

        if (version == "latest") {
            const manifestUrl = `https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`;
            try {
                const response = await fetch(manifestUrl);
                if (response.ok) {
                    version = (await response.json() as any).version;
                }
            } catch (e) {
                let existingVersions: string[] = []
                if (await fileExists(pluginDir)) {
                    existingVersions = (await fsAsync.readdir(pluginDir))
                        .map(v => semver.valid(v)!)
                        .filter(v => v)
                        .sort(semver.compare);
                }
                if (existingVersions.length > 0) {
                    version = existingVersions.at(-1)!;
                    console.warn(`Unable to download ${repo} manifest.json, using cached plugin version.`);
                } else {
                    throw e
                }
            }
        }
        if (!version || version == "latest") { // We didn't find a specific version to use
            throw Error(`No manifest.json found for ${repo}`);
        } else if (!semver.valid(version)) {
            throw Error(`Invalid version "${version}"`);
        }
        version = semver.valid(version)!;
        pluginDir = path.join(pluginDir, version);

        if (!(await fileExists(pluginDir))) {
            await fsAsync.mkdir(path.dirname(pluginDir), { recursive: true });
            await withTmpDir(pluginDir, async (tmpDir) => {
                const assetsToDownload = {'manifest.json': true, 'main.js': true, 'styles.css': false};
                await Promise.all(
                    Object.entries(assetsToDownload).map(async ([file, required]) => {
                        const url = `https://github.com/${repo}/releases/download/${version}/${file}`;
                        const response = await fetch(url);
                        if (response.ok) {
                            await fsAsync.writeFile(path.join(tmpDir, file), response.body as any);
                        } else if (required) {
                            throw Error(`No ${file} found for ${repo} version ${version}`)
                        }
                    })
                )
                return tmpDir;
            });
        }

        return pluginDir;
    }

    /**
     * Downloads a community plugin
     * @param id Id of the plugin
     * @param version Version of the plugin to install, or "latest"
     * @returns path to the downloaded plugin
     */
    async downloadCommunityPlugin(id: string, version = "latest"): Promise<string> {
        const communityPlugins = await this.getCommunityPlugins();
        const pluginInfo = communityPlugins.find(p => p.id == id);
        if (!pluginInfo) {
            throw Error(`No plugin with id ${id} found.`);
        }
        return await this.downloadGitHubPlugin(pluginInfo.repo, version);
    }

    /**
     * Downloads a list of plugins.
     * Also adds the `id` property to the plugins based on the manifest.
     */
    async downloadPlugins(plugins: PluginEntry[]): Promise<(LocalPluginEntry & {id: string})[]> {
        return await Promise.all(
            plugins.map(async (plugin) => {
                let pluginPath: string
                if (typeof plugin == "string") {
                    pluginPath = plugin;
                } else if ("path" in plugin) {;
                    pluginPath = plugin.path;
                } else if ("repo" in plugin) {
                    pluginPath = await this.downloadGitHubPlugin(plugin.repo, plugin.version);
                } else if ("id" in plugin) {
                    pluginPath = await this.downloadCommunityPlugin(plugin.id, plugin.version);
                } else {
                    throw Error("You must specify one of plugin path, repo, or id")
                }
                const manifestPath = path.join(pluginPath, "manifest.json");
                const pluginId = JSON.parse(await fsAsync.readFile(manifestPath, 'utf8').catch(e => "{}")).id;
                if (!pluginId) {
                    throw Error(`${pluginPath}/manifest.json missing or malformed.`);
                }
                const enabled = typeof plugin == "string" ? true : (plugin.enabled ?? true);
                return {path: pluginPath, id: pluginId, enabled: enabled}
            })
        );
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
        appPath: string, vault?: string, plugins?: LocalPluginEntry[],
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
        await linkOrCp(params.appPath, path.join(configDir, path.basename(params.appPath)));
        const localStorage = new ChromeLocalStorage(configDir);
        await localStorage.setItems("app://obsidian.md", localStorageData)
        await localStorage.close();

        return tmpDir;
    }
}
