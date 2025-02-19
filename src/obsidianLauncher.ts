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
import child_process from "child_process"
import semver from "semver"
import CDP from 'chrome-remote-interface'
import { fileExists, withTmpDir, linkOrCp, maybe, pool, withTimeout, sleep } from "./utils.js";
import {
    ObsidianVersionInfo, ObsidianCommunityPlugin, ObsidianCommunityTheme,
    PluginEntry, LocalPluginEntryWithId, ThemeEntry, LocalThemeEntryWithName,
    ObsidianVersionInfos,
} from "./types.js";
import { fetchObsidianAPI, fetchGitHubAPIPaginated, fetchWithFileUrl } from "./apis.js";
import ChromeLocalStorage from "./chromeLocalStorage.js";
import {
    normalizeGitHubRepo, extractObsidianAppImage, extractObsidianExe,
    parseObsidianDesktopRelease, parseObsidianGithubRelease, correctObsidianVersionInfo,
} from "./launcherUtils.js";
import _ from "lodash"


/**
 * Handles downloading Obsidian versions, plugins, and themes and launching obsidian with sandboxed configuration.
 */
export default class ObsidianLauncher {
    readonly cacheDir: string

    readonly versionsUrl: string
    readonly communityPluginsUrl: string
    readonly communityThemesUrl: string

    /** Cached requests from cachedFetch() */
    private metadataCache: Record<string, any>

    /**
     * Construct an ObsidianLauncher.
     * @param cacheDir Path to the cache directory. Defaults to "OBSIDIAN_CACHE" env var or ".obsidian-cache".
     * @param versionsUrl Custom `obsidian-versions.json` url. Can be a file URL.
     * @param communityPluginsUrl Custom `community-plugins.json` url. Can be a file URL.
     * @param communityThemes Custom `community-css-themes.json` url. Can be a file URL.
     */
    constructor(options: {
        cacheDir?: string,
        versionsUrl?: string,
        communityPluginsUrl?: string,
        communityThemesUrl?: string,
    } = {}) {
        this.cacheDir = path.resolve(options.cacheDir ?? process.env.OBSIDIAN_CACHE ?? "./.obsidian-cache");
        
        const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
        const defaultVersionsUrl =  pathToFileURL(path.join(packageDir, "obsidian-versions.json")).toString(); // TODO
        this.versionsUrl = options.versionsUrl ?? defaultVersionsUrl;
        
        const defaultCommunityPluginsUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";
        this.communityPluginsUrl = options.communityPluginsUrl ?? defaultCommunityPluginsUrl;

        const defaultCommunityThemesUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json";
        this.communityThemesUrl = options.communityThemesUrl ?? defaultCommunityThemesUrl;

        this.metadataCache = {};
    }

    /**
     * Returns file content fetched from url as JSON. Caches content to dest and uses that cache if its more recent than
     * cacheDuration ms or if there are network errors.
     */
    private async cachedFetch(url: string, dest: string, { cacheDuration = 30 * 60 * 1000 } = {}): Promise<any> {
        dest = path.resolve(dest);
        if (!(dest in this.metadataCache)) {
            let fileContent: string|undefined;
            const mtime = await fileExists(dest) ? (await fsAsync.stat(dest)).mtime : undefined;

            if (mtime && new Date().getTime() - mtime.getTime() < cacheDuration) { // read from cache if its recent
                fileContent = await fsAsync.readFile(dest, 'utf-8');
            } else { // otherwise try to fetch the url
                const request = await maybe(fetchWithFileUrl(url));
                if (request.success) {
                    await fsAsync.mkdir(path.dirname(dest), { recursive: true });
                    await withTmpDir(dest, async (tmpDir) => {
                        await fsAsync.writeFile(path.join(tmpDir, 'download.json'), request.result);
                        return path.join(tmpDir, 'download.json');
                    })
                    fileContent = request.result;
                } else if (await fileExists(dest)) { // use cache on network error
                    console.warn(request.error)
                    console.warn(`Unable to download ${dest}, using cached file.`);
                    fileContent = await fsAsync.readFile(dest, 'utf-8');
                } else {
                    throw request.error;
                }
            }

            this.metadataCache[dest] = JSON.parse(fileContent);
        }
        return this.metadataCache[dest];
    }

    /** Get information about all available Obsidian versions. */
    async getVersions(): Promise<ObsidianVersionInfo[]> {
        const dest = path.join(this.cacheDir, "obsidian-versions.json");
        return (await this.cachedFetch(this.versionsUrl, dest)).versions;
    }

    /** Get information about all available community plugins. */
    async getCommunityPlugins(): Promise<ObsidianCommunityPlugin[]> {
        const dest = path.join(this.cacheDir, "obsidian-community-plugins.json");
        return await this.cachedFetch(this.communityPluginsUrl, dest);
    }

    /** Get information about all available community themes. */
    async getCommunityThemes(): Promise<ObsidianCommunityTheme[]> {
        const dest = path.join(this.cacheDir, "obsidian-community-css-themes.json");
        return await this.cachedFetch(this.communityThemesUrl, dest);
    }

    /**
     * Resolves Obsidian version strings to absolute obsidian versions.
     * @param appVersion Obsidian version string or "latest" or "latest-beta"
     * @param installerVersion Obsidian version string or "latest" or "earliest"
     * @returns [appVersion, installerVersion] with any "latest" etc. resolved to specific versions.
     */
    async resolveVersions(appVersion: string, installerVersion = "latest"): Promise<[string, string]> {
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

        return [appVersionInfo.version, installerVersionInfo.version];
    }

    /** Gets details about an Obsidian version */
    async getVersionInfo(version: string): Promise<ObsidianVersionInfo> {
        version = (await this.resolveVersions(version))[0]
        const result = (await this.getVersions()).find(v => v.version == version);
        if (!result) {
            throw Error(`No Obsidian version ${version} found`);
        }
        return result;
    }

    /**
     * Downloads the Obsidian installer for the given version and platform. Returns the file path.
     * @param installerVersion Version to download.
     */
    async downloadInstaller(installerVersion: string): Promise<string> {
        const installerVersionInfo = await this.getVersionInfo(installerVersion);
        return await this.downloadInstallerFromVersionInfo(installerVersionInfo);
    }

    /**
     * Helper for downloadInstaller that doesn't require the obsidian-versions.json file so it can be used in
     * updateObsidianVersionInfos
     */
    private async downloadInstallerFromVersionInfo(versionInfo: ObsidianVersionInfo): Promise<string> {
        const installerVersion = versionInfo.version;
        const {platform, arch} = process;
        const cacheDir = path.join(this.cacheDir, `obsidian-installer/${platform}-${arch}/Obsidian-${installerVersion}`);
        
        let installerPath: string
        let downloader: ((tmpDir: string) => Promise<string>)|undefined
        
        if (platform == "linux") {
            installerPath = path.join(cacheDir, "obsidian");
            let installerUrl: string|undefined
            if (arch.startsWith("arm")) {
                installerUrl = versionInfo.downloads.appImageArm;
            } else {
                installerUrl = versionInfo.downloads.appImage;
            }
            if (installerUrl) {
                downloader = async (tmpDir) => {
                    const appImage = path.join(tmpDir, "Obsidian.AppImage");
                    await fsAsync.writeFile(appImage, (await fetch(installerUrl)).body as any);
                    const obsidianFolder = path.join(tmpDir, "Obsidian");
                    await extractObsidianAppImage(appImage, obsidianFolder);
                    return obsidianFolder;
                };
            }
        } else if (platform == "win32") {
            installerPath = path.join(cacheDir, "Obsidian.exe")
            const installerUrl = versionInfo.downloads.exe;
            let appArch: string|undefined
            if (arch == "x64") {
                appArch = "app-64"
            } else if (arch == "ia32") {
                appArch = "app-32"
            } else if (arch.startsWith("arm")) {
                appArch = "app-arm64"
            }
            if (installerUrl && appArch) {
                downloader = async (tmpDir) => {
                    const installerExecutable = path.join(tmpDir, "Obsidian.exe");
                    await fsAsync.writeFile(installerExecutable, (await fetch(installerUrl)).body as any);
                    const obsidianFolder = path.join(tmpDir, "Obsidian");
                    await extractObsidianExe(installerExecutable, appArch, obsidianFolder);
                    return obsidianFolder;
                };
            }
        } else {
            throw Error(`Unsupported platform ${platform}`);
        }
        if (!downloader) {
            throw Error(`No Obsidian installer download available for v${installerVersion} ${platform} ${arch}`);
        }

        if (!(await fileExists(installerPath))) {
            console.log(`Downloading Obsidian installer v${installerVersion}...`)
            await fsAsync.mkdir(path.dirname(cacheDir), { recursive: true });
            await withTmpDir(cacheDir, downloader);
        }

        return installerPath;
    }

    /**
     * Downloads the Obsidian asar for the given version and platform. Returns the file path.
     * @param appVersion Version to download.
     */
    async downloadApp(appVersion: string): Promise<string> {
        const appVersionInfo = await this.getVersionInfo(appVersion);
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
        const versionInfo = await this.getVersionInfo(installerVersion);
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

    /** Gets the latest version of a plugin. */
    async getLatestPluginVersion(repo: string) {
        repo = normalizeGitHubRepo(repo)
        const manifestUrl = `https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`;
        const cacheDest = path.join(this.cacheDir, "obsidian-plugins", repo, "latest.json");
        const manifest = await this.cachedFetch(manifestUrl, cacheDest);
        return manifest.version;
    }

    /**
     * Downloads a plugin from a GitHub repo to the cache.
     * @param repo Repo
     * @param version Version of the plugin to install or "latest"
     * @returns path to the downloaded plugin
     */
    async downloadGitHubPlugin(repo: string, version = "latest"): Promise<string> {
        repo = normalizeGitHubRepo(repo)
        if (version == "latest") {
            version = await this.getLatestPluginVersion(repo);
        }
        if (!semver.valid(version)) {
            throw Error(`Invalid version "${version}"`);
        }
        version = semver.valid(version)!;

        const pluginDir = path.join(this.cacheDir, "obsidian-plugins", repo, version);
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
     * Downloads a community plugin to the cache.
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
    async downloadPlugins(plugins: PluginEntry[]): Promise<LocalPluginEntryWithId[]> {
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

                let pluginId = (typeof plugin == "object" && ("id" in plugin)) ? plugin.id : undefined;
                if (!pluginId) {
                    const manifestPath = path.join(pluginPath, "manifest.json");
                    pluginId = JSON.parse(await fsAsync.readFile(manifestPath, 'utf8').catch(() => "{}")).id;
                    if (!pluginId) {
                        throw Error(`${pluginPath}/manifest.json missing or malformed.`);
                    }
                }
                const enabled = typeof plugin == "string" ? true : plugin.enabled;
                return {path: pluginPath, id: pluginId, enabled: enabled}
            })
        );
    }

    /** Gets the latest version of a theme. */
    async getLatestThemeVersion(repo: string) {
        repo = normalizeGitHubRepo(repo)
        const manifestUrl = `https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`;
        const cacheDest = path.join(this.cacheDir, "obsidian-themes", repo, "latest.json");
        const manifest = await this.cachedFetch(manifestUrl, cacheDest);
        return manifest.version;
    }

    /**
     * Downloads a theme from a GitHub repo to the cache.
     * @param repo Repo
     * @returns path to the downloaded theme
     */
    async downloadGitHubTheme(repo: string): Promise<string> {
        repo = normalizeGitHubRepo(repo)
        // Obsidian theme's are just pulled from the repo HEAD, not releases, so we can't really choose a specific 
        // version of a theme.
        // We use the manifest.json version to check if the theme has changed.
        const version = await this.getLatestThemeVersion(repo);
        const themeDir = path.join(this.cacheDir, "obsidian-themes", repo, version);

        if (!(await fileExists(themeDir))) {
            await fsAsync.mkdir(path.dirname(themeDir), { recursive: true });
            await withTmpDir(themeDir, async (tmpDir) => {
                const assetsToDownload = ['manifest.json', 'theme.css'];
                await Promise.all(
                    assetsToDownload.map(async (file) => {
                        const url = `https://raw.githubusercontent.com/${repo}/HEAD/${file}`;
                        const response = await fetch(url);
                        if (response.ok) {
                            await fsAsync.writeFile(path.join(tmpDir, file), response.body as any);
                        } else {
                            throw Error(`No ${file} found for ${repo}`);
                        }
                    })
                )
                return tmpDir;
            });
        }

        return themeDir;
    }

    /**
     * Downloads a community theme to the cache.
     * @param name name of the theme
     * @returns path to the downloaded theme
     */
    async downloadCommunityTheme(name: string): Promise<string> {
        const communityThemes = await this.getCommunityThemes();
        const themeInfo = communityThemes.find(p => p.name == name);
        if (!themeInfo) {
            throw Error(`No theme with name ${name} found.`);
        }
        return await this.downloadGitHubTheme(themeInfo.repo);
    }

    /**
     * Downloads a list of themes to the cache.
     * Also adds the `name` property to the themes based on the manifest.
     */
    async downloadThemes(themes: ThemeEntry[]): Promise<LocalThemeEntryWithName[]> {
        return await Promise.all(
            themes.map(async (theme) => {
                let themePath: string
                if (typeof theme == "string") {
                    themePath = theme;
                } else if ("path" in theme) {;
                    themePath = theme.path;
                } else if ("repo" in theme) {
                    themePath = await this.downloadGitHubTheme(theme.repo);
                } else if ("name" in theme) {
                    themePath = await this.downloadCommunityTheme(theme.name);
                } else {
                    throw Error("You must specify one of theme path, repo, or name")
                }
                let themeName = (typeof theme == "object" && ("name" in theme)) ? theme.name : undefined;
                if (!themeName) {
                    const manifestPath = path.join(themePath, "manifest.json");
                    themeName = JSON.parse(await fsAsync.readFile(manifestPath, 'utf8').catch(() => "{}")).name;
                    if (!themeName) {
                        throw Error(`${themePath}/manifest.json missing or malformed.`);
                    }
                }
                const enabled = typeof theme == "string" ? true : theme.enabled;
                return {path: themePath, name: themeName, enabled: enabled}
            })
        );
    }

    /**
     * Installs plugins into an Obsidian vault.
     * @param vault Path to the vault to install the plugin in.
     * @param plugins List plugins paths to install.
     */
    async installPlugins(vault: string, plugins: PluginEntry[]) {
        const downloadedPlugins = await this.downloadPlugins(plugins);

        const obsidianDir = path.join(vault, '.obsidian');
        await fsAsync.mkdir(obsidianDir, { recursive: true });

        const enabledPluginsPath = path.join(obsidianDir, 'community-plugins.json');
        let originalEnabledPlugins: string[] = [];
        if (await fileExists(enabledPluginsPath)) {
            originalEnabledPlugins = JSON.parse(await fsAsync.readFile(enabledPluginsPath, 'utf-8'));
        }
        let enabledPlugins = [...originalEnabledPlugins];

        for (const {path: pluginPath, enabled = true} of downloadedPlugins) {
            const manifestPath = path.join(pluginPath, 'manifest.json');
            const pluginId = JSON.parse(await fsAsync.readFile(manifestPath, 'utf8').catch(() => "{}")).id;
            if (!pluginId) {
                throw Error(`${manifestPath} missing or malformed.`);
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

        if (!_.isEqual(enabledPlugins, originalEnabledPlugins)) {
            await fsAsync.writeFile(enabledPluginsPath, JSON.stringify(enabledPlugins, undefined, 2));
        }
    }

    /** 
     * Installs themes into an obsidian vault.
     * @param vault Path to the theme to install the plugin in.
     * @param themes: List of themes to install.
     */
    async installThemes(vault: string, themes: ThemeEntry[]) {
        const downloadedThemes = await this.downloadThemes(themes);

        const obsidianDir = path.join(vault, '.obsidian');
        await fsAsync.mkdir(obsidianDir, { recursive: true });

        let enabledTheme: string|undefined = undefined;

        for (const {path: themePath, enabled = true} of downloadedThemes) {
            const manifestPath = path.join(themePath, 'manifest.json');
            const cssPath = path.join(themePath, 'theme.css');

            const themeName = JSON.parse(await fsAsync.readFile(manifestPath, 'utf8').catch(() => "{}")).name;
            if (!themeName) {
                throw Error(`${manifestPath} missing or malformed.`);
            }
            if (!(await fileExists(cssPath))) {
                throw Error(`${cssPath} missing.`);
            }

            const themeDest = path.join(obsidianDir, 'themes', themeName);
            await fsAsync.rm(themeDest, { recursive: true, force: true });
            await fsAsync.mkdir(themeDest, { recursive: true });

            await linkOrCp(manifestPath, path.join(themeDest, "manifest.json"));
            await linkOrCp(cssPath, path.join(themeDest, "theme.css"));

            if (enabledTheme && enabled) {
                throw Error("You can only have one enabled theme.")
            } else if (enabled) {
                enabledTheme = themeName;
            }
        }

        if (themes.length > 0) { // Only update appearance.json if we set the themes
            const appearancePath = path.join(obsidianDir, 'appearance.json');
            let appearance: any = {}
            if (await fileExists(appearancePath)) {
                appearance = JSON.parse(await fsAsync.readFile(appearancePath, 'utf-8'));
            }
            appearance.cssTheme = enabledTheme ?? "";
            await fsAsync.writeFile(appearancePath, JSON.stringify(appearance, undefined, 2));
        }
    }

    /**
     * Sets up the config dir to use for the --user-data-dir in obsidian. Returns the path to the created config dir.
     *
     * @param appVersion Obsidian version string.
     * @param installerVersion Obsidian version string.
     * @param appPath Path to the asar file to install.
     * @param vault Path to the vault to open in Obsidian.
     * @param plugins List of plugins to install in the vault.
     * @param themes List of themes to install in the vault.
     * @param dest Destination path for the config dir. If omitted it will create it under `/tmp`.
     */
    async setupConfigDir(params: {
        appVersion: string, installerVersion: string,
        appPath?: string,
        vault?: string,
        plugins?: PluginEntry[], themes?: ThemeEntry[],
        dest?: string,
    }): Promise<string> {
        const [appVersion, installerVersion] = await this.resolveVersions(params.appVersion, params.installerVersion);
        // configDir will be passed to --user-data-dir, so Obsidian is somewhat sandboxed. We set up "obsidian.json" so
        // that Obsidian opens the vault by default and doesn't check for updates.
        const configDir = params.dest ?? await fsAsync.mkdtemp(path.join(os.tmpdir(), 'obs-launcher-config-'));
    
        let obsidianJson: any = {
            updateDisabled: true, // Prevents Obsidian trying to auto-update on boot.
        }
        let localStorageData: Record<string, string> = {
            "most-recently-installed-version": appVersion, // prevents the changelog page on boot
        }

        if (params.vault !== undefined) {
            await this.installPlugins(params.vault, params.plugins ?? []);
            await this.installThemes(params.vault, params.themes ?? []);

            const vaultId = "1234567890abcdef";
            obsidianJson = {
                ...obsidianJson,
                vaults: {
                    [vaultId]: {
                        path: path.resolve(params.vault),
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
        if (params.appPath) {
            await linkOrCp(params.appPath, path.join(configDir, path.basename(params.appPath)));
        } else if (appVersion != installerVersion) {
            throw Error("You must specify app path if appVersion != installerVersion");
        }
        const localStorage = new ChromeLocalStorage(configDir);
        await localStorage.setItems("app://obsidian.md", localStorageData)
        await localStorage.close();

        return configDir;
    }

    /**
     * Copies a vault to a temporary directory.
     * @returns Path to the created tmpDir.
     */
    async copyVault(src: string) {
        const dest = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'obs-launcher-vault-'));
        await fsAsync.cp(src, dest, { recursive: true });
        return dest;
    }

    /**
     * Downloads and launches Obsidian with a sandboxed config dir. Optionally open a specific vault and install plugins
     * and themes first.
     *
     * @param appVersion Obsidian version string.
     * @param installerVersion Obsidian version string.
     * @param vault Path to the vault to open in Obsidian.
     * @param plugins List of plugins to install in the vault.
     * @param themes List of themes to install in the vault.
     * @param dest Destination path for the config dir. If omitted it will create it under `/tmp`.
     * @param args CLI args to pass to Obsidian
     * @param spawnOptions Options to pass to `spawn`.
     * @returns The launched child process and the created config dir.
     */
    async launch(params: {
        appVersion: string, installerVersion: string,
        vault?: string,
        plugins?: PluginEntry[], themes?: ThemeEntry[],
        dest?: string,
        args?: string[],
        spawnOptions?: child_process.SpawnOptions,
    }): Promise<[child_process.ChildProcess, string]> {
        const [appVersion, installerVersion] = await this.resolveVersions(params.appVersion, params.installerVersion);
        const appPath = await this.downloadApp(appVersion);
        const installerPath = await this.downloadInstaller(installerVersion);

        const configDir = await this.setupConfigDir({
            appVersion: appVersion, installerVersion: installerVersion,
            appPath: appPath,
            vault: params.vault,
            plugins: params.plugins, themes: params.themes,
        });

        // Spawn child.
        const proc = child_process.spawn(installerPath, [
            `--user-data-dir=${configDir}`,
            ...(params.args ?? []),
        ], {
            ...params.spawnOptions,
        });

        return [proc, configDir];
    }


    /**
     * Extract electron and chrome versions for an Obsidian version.
     */
    async getDependencyVersions(versionInfo: Partial<ObsidianVersionInfo>): Promise<Partial<ObsidianVersionInfo>> {
        const binary = await this.downloadInstallerFromVersionInfo(versionInfo as ObsidianVersionInfo);
        console.log(`${versionInfo.version!}: Extracting electron & chrome versions...`);

        const configDir = await fsAsync.mkdtemp(path.join(os.tmpdir(), `fetch-obsidian-versions-`));

        const proc = child_process.spawn(binary, [
            `--remote-debugging-port=0`, // 0 will make it choose a random available port
            '--test-type=webdriver',
            `--user-data-dir=${configDir}`,
            '--no-sandbox', // Workaround for SUID issue, see https://github.com/electron/electron/issues/42510
            '--headless',
        ]);
        const procExit = new Promise<number>((resolve) => proc.on('exit', (code) => resolve(code ?? -1)));
        // proc.stdout.on('data', data => console.log(`stdout: ${data}`));
        // proc.stderr.on('data', data => console.log(`stderr: ${data}`));

        let dependencyVersions: any;
        try {
            // Wait for the logs showing that Obsidian is ready, and pull the chosen DevTool Protocol port from it
            const portPromise = new Promise<number>((resolve, reject) => {
                procExit.then(() => reject("Processed ended without opening a port"))
                proc.stderr.on('data', data => {
                    const port = data.toString().match(/ws:\/\/[\w.]+?:(\d+)/)?.[1];
                    if (port) {
                        resolve(Number(port));
                    }
                });
            })

            const port = await maybe(withTimeout(portPromise, 10 * 1000));
            if (!port.success) {
                throw new Error("Timed out waiting for Chrome DevTools protocol port");
            }
            const client = await CDP({port: port.result});
            const response = await client.Runtime.evaluate({ expression: "JSON.stringify(process.versions)" });
            dependencyVersions = JSON.parse(response.result.value);
            await client.close();
        } finally {
            proc.kill("SIGTERM");
            const timeout = await maybe(withTimeout(procExit, 4 * 1000));
            if (!timeout.success) {
                console.log(`${versionInfo.version!}: Stuck process ${proc.pid}, using SIGKILL`);
                proc.kill("SIGKILL");
            }
            await procExit;
            await sleep(1000); // Need to wait a bit or sometimes the rm fails because something else is writing to it
            await fsAsync.rm(configDir, { recursive: true, force: true });
        }

        if (!dependencyVersions?.electron || !dependencyVersions?.chrome) {
            throw Error(`Failed to extract electron and chrome versions for ${versionInfo.version!}`)
        }

        return {
            ...versionInfo,
            electronVersion: dependencyVersions.electron,
            chromeVersion: dependencyVersions.chrome,
            nodeVersion: dependencyVersions.node,
        };
    }

    /** 
     * Updates the info obsidian-versions.json. The obsidian-versions.json file is used in other launcher commands
     * and in wdio-obsidian-service to get metadata about Obsidian versions in one place such as minInstallerVersion and
     * the internal electron version.
     */
    async updateObsidianVersionInfos(
        original?: ObsidianVersionInfos, { maxInstances = 1 } = {},
    ): Promise<ObsidianVersionInfos> {
        const repo = 'obsidianmd/obsidian-releases';

        let commitHistory = await fetchGitHubAPIPaginated(`repos/${repo}/commits`, {
            path: "desktop-releases.json",
            since: original?.latest.date,
        });
        commitHistory.reverse();
        if (original) {
            commitHistory = _.takeRightWhile(commitHistory, c => c.sha != original.latest.sha);
        }
    
        const fileHistory: any[] = await pool(8, commitHistory, commit =>
            fetch(`https://raw.githubusercontent.com/${repo}/${commit.sha}/desktop-releases.json`).then(r => r.json())
        );
    
        const githubReleases = await fetchGitHubAPIPaginated(`repos/${repo}/releases`);
    
        const versionMap: _.Dictionary<Partial<ObsidianVersionInfo>> = _.keyBy(
            original?.versions ?? [],
            v => v.version,
        );
    
        for (const {beta, ...current} of fileHistory) {
            if (beta && (!versionMap[beta.latestVersion] || versionMap[beta.latestVersion].isBeta)) {
                versionMap[beta.latestVersion] = _.merge({}, versionMap[beta.latestVersion],
                    parseObsidianDesktopRelease(beta, true),
                );
            }
            versionMap[current.latestVersion] = _.merge({}, versionMap[current.latestVersion],
                parseObsidianDesktopRelease(current, false),
            )
        }
    
        for (const release of githubReleases) {
            if (versionMap.hasOwnProperty(release.name)) {
                versionMap[release.name] = _.merge({}, versionMap[release.name], parseObsidianGithubRelease(release));
            }
        }
    
        const dependencyVersions = await pool(maxInstances,
            Object.values(versionMap).filter(v => v.downloads?.appImage && !v.chromeVersion),
            (v) => this.getDependencyVersions(v),
        )
        for (const deps of dependencyVersions) {
            versionMap[deps.version!] = _.merge({}, versionMap[deps.version!], deps);
        }
    
        // populate maxInstallerVersion and add corrections
        let maxInstallerVersion = "0.0.0"
        for (const version of Object.keys(versionMap).sort(semver.compare)) {
            if (versionMap[version].downloads!.appImage) {
                maxInstallerVersion = version;
            }
            versionMap[version] = _.merge({}, versionMap[version],
                correctObsidianVersionInfo(versionMap[version]),
                { maxInstallerVersion },
            );
        }
    
        const versionInfos = Object.values(versionMap) as ObsidianVersionInfo[]
        versionInfos.sort((a, b) => semver.compare(a.version, b.version));
    
        return {
            latest: {
                date: commitHistory.at(-1)?.commit.committer.date ?? original?.latest.date,
                sha: commitHistory.at(-1)?.sha ?? original?.latest.sha,
            },
            versions: versionInfos,
        }
    }
}
