import fsAsync from "fs/promises"
import path from "path"
import crypto from "crypto";
import extractZip from "extract-zip"
import { downloadArtifact } from '@electron/get';
import child_process from "child_process"
import semver from "semver"
import { fileURLToPath } from "url";
import { fileExists, makeTmpDir, atomicCreate, linkOrCp, maybe, pool, mergeKeepUndefined } from "./utils.js";
import {
    ObsidianVersionInfo, ObsidianCommunityPlugin, ObsidianCommunityTheme, ObsidianVersionInfos, ObsidianInstallerInfo,
    PluginEntry, DownloadedPluginEntry, ThemeEntry, DownloadedThemeEntry,
} from "./types.js";
import { fetchObsidianAPI, fetchGitHubAPIPaginated, downloadResponse } from "./apis.js";
import ChromeLocalStorage from "./chromeLocalStorage.js";
import {
    normalizeGitHubRepo, extractGz, extractObsidianAppImage, extractObsidianExe, extractObsidianDmg,
    parseObsidianDesktopRelease, parseObsidianGithubRelease, correctObsidianVersionInfo,
    getInstallerInfo, normalizeObsidianVersionInfo,
} from "./launcherUtils.js";
import _ from "lodash"


/**
 * The `ObsidianLauncher` class.
 * 
 * Helper class that handles downloading and installing Obsidian versions, plugins, and themes and launching Obsidian
 * with sandboxed configuration directories.
 */
export class ObsidianLauncher {
    readonly cacheDir: string

    readonly versionsUrl: string
    readonly communityPluginsUrl: string
    readonly communityThemesUrl: string
    readonly cacheDuration: number

    /** Cached metadata files and requests */
    private metadataCache: Record<string, any>

    /**
     * Construct an ObsidianLauncher.
     * @param options.cacheDir Path to the cache directory. Defaults to "OBSIDIAN_CACHE" env var or ".obsidian-cache".
     * @param options.versionsUrl Custom `obsidian-versions.json` url. Can be a file URL.
     * @param options.communityPluginsUrl Custom `community-plugins.json` url. Can be a file URL.
     * @param options.communityThemesUrl Custom `community-css-themes.json` url. Can be a file URL.
     * @param options.cacheDuration If the cached version list is older than this (in ms), refetch it. Defaults to 30 minutes.
     */
    constructor(options: {
        cacheDir?: string,
        versionsUrl?: string,
        communityPluginsUrl?: string,
        communityThemesUrl?: string,
        cacheDuration?: number,
    } = {}) {
        this.cacheDir = path.resolve(options.cacheDir ?? process.env.OBSIDIAN_CACHE ?? "./.obsidian-cache");
        
        const defaultVersionsUrl =  'https://raw.githubusercontent.com/jesse-r-s-hines/wdio-obsidian-service/HEAD/obsidian-versions.json'
        this.versionsUrl = options.versionsUrl ?? defaultVersionsUrl;
        
        const defaultCommunityPluginsUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";
        this.communityPluginsUrl = options.communityPluginsUrl ?? defaultCommunityPluginsUrl;

        const defaultCommunityThemesUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json";
        this.communityThemesUrl = options.communityThemesUrl ?? defaultCommunityThemesUrl;

        this.cacheDuration = options.cacheDuration ?? (30 * 60 * 1000);

        this.metadataCache = {};
    }

    /**
     * Returns file content fetched from url as JSON. Caches content to dest and uses that cache if its more recent than
     * cacheDuration ms or if there are network errors.
     */
    private async cachedFetch(url: string, dest: string): Promise<any> {
        dest = path.join(this.cacheDir, dest);
        if (!(dest in this.metadataCache)) {
            let fileContent: string;

            if (url.startsWith("file:")) {
                fileContent = await fsAsync.readFile(fileURLToPath(url), 'utf-8');
            } else {
                const mtime = await fileExists(dest) ? (await fsAsync.stat(dest)).mtime : undefined;

                // read from cache if its recent
                if (mtime && new Date().getTime() - mtime.getTime() < this.cacheDuration) {
                    fileContent = await fsAsync.readFile(dest, 'utf-8');
                } else { // otherwise try to fetch the url
                    const request = await maybe(fetch(url).then(r => r.text()));
                    if (request.success) {
                        await atomicCreate(dest, async (tmpDir) => {
                            try {
                                JSON.parse(request.result);
                            } catch (e) {
                                throw Error(`Failed to parse response from ${url}: ${e}`)
                            }
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
            }

            this.metadataCache[dest] = JSON.parse(fileContent);
        }
        return this.metadataCache[dest];
    }

    /**
     * Get parsed content of the current project's manifest.json
     */
    private async getRootManifest(): Promise<any> {
        if (!('manifest.json' in this.metadataCache)) {
            const root = path.parse(process.cwd()).root;
            let dir = process.cwd();
            while (dir != root && !(await fileExists(path.join(dir, 'manifest.json')))) {
                dir = path.dirname(dir);
            }
            const manifestPath = path.join(dir, 'manifest.json');
            if (await fileExists(manifestPath)) {
                this.metadataCache['manifest.json'] = JSON.parse(await fsAsync.readFile(manifestPath, 'utf-8'));
            } else {
                this.metadataCache['manifest.json'] = null;
            }
        }
        return this.metadataCache['manifest.json'];
    }

    /**
     * Get information about all available Obsidian versions.
     */
    async getVersions(): Promise<ObsidianVersionInfo[]> {
        const versionsFile: ObsidianVersionInfos = await this.cachedFetch(this.versionsUrl, "obsidian-versions.json");
        const schemaVersion = versionsFile.metadata.schemaVersion ?? "v1";
        if (schemaVersion != "v1") {
            throw new Error(`${this.versionsUrl} format has changed, please update obsidian-launcher and wdio-obsidian-service`)
        }
        return versionsFile.versions;
    }

    /**
     * Get information about all available community plugins.
     */
    async getCommunityPlugins(): Promise<ObsidianCommunityPlugin[]> {
        return await this.cachedFetch(this.communityPluginsUrl, "obsidian-community-plugins.json");
    }

    /**
     * Get information about all available community themes.
     */
    async getCommunityThemes(): Promise<ObsidianCommunityTheme[]> {
        return await this.cachedFetch(this.communityThemesUrl, "obsidian-community-css-themes.json");
    }

    /**
     * Resolves Obsidian app and installer version strings to absolute versions.
     * @param appVersion Obsidian version string or one of 
     *   - "latest": Get the current latest non-beta Obsidian version
     *   - "latest-beta": Get the current latest beta Obsidian version (or latest is there is no current beta)
     *   - "earliest": Get the `minAppVersion` set in your `manifest.json`
     * @param installerVersion Obsidian version string or one of 
     *   - "latest": Get the latest Obsidian installer compatible with `appVersion`
     *   - "earliest": Get the oldest Obsidian installer compatible with `appVersion`
     * 
     * See also: [Obsidian App vs Installer Versions](../README.md#obsidian-app-vs-installer-versions)
     *
     * @returns [appVersion, installerVersion] with any "latest" etc. resolved to specific versions.
     */
    async resolveVersions(appVersion: string, installerVersion = "latest"): Promise<[string, string]> {
        const versions = await this.getVersions();
        const appVersionInfo = await this.getVersionInfo(appVersion);
        appVersion = appVersionInfo.version;
        let installerVersionInfo: ObsidianVersionInfo|undefined;
        const { platform, arch } = process;

        if (!appVersionInfo.minInstallerVersion || !appVersionInfo.maxInstallerVersion) {
            throw Error(`No installers available for Obsidian ${appVersion}`);
        }
        if (installerVersion == "latest") {
            installerVersionInfo = _.findLast(versions, v =>
                semver.lte(v.version, appVersionInfo.version) && !!this.getInstallerUrl(v, platform, arch)
            );
        } else if (installerVersion == "earliest") {
            installerVersionInfo = versions.find(v =>
                semver.gte(v.version, appVersionInfo.minInstallerVersion!) && !!this.getInstallerUrl(v, platform, arch)
            );
        } else {
            installerVersion = semver.valid(installerVersion) ?? installerVersion; // normalize
            installerVersionInfo = versions.find(v => v.version == installerVersion);
        }
        if (!installerVersionInfo) {
            if (["earliest", "latest"].includes(installerVersion)) {
                throw Error(`No compatible installers available for Obsidian ${appVersion}`);
            } else {
                throw Error(`No Obsidian installer ${installerVersion} found`);
            }
        }

        if (
            semver.lt(installerVersionInfo.version, appVersionInfo.minInstallerVersion) ||
            semver.gt(installerVersionInfo.version, appVersionInfo.maxInstallerVersion)
        ) {
            throw Error(
                `App and installer versions incompatible: app ${appVersionInfo.version} is compatible with installer ` +
                `>=${appVersionInfo.minInstallerVersion} <=${appVersionInfo.maxInstallerVersion} but ` +
                `${installerVersionInfo.version} specified`
            )
        }

        return [appVersionInfo.version, installerVersionInfo.version];
    }

    /**
     * Gets details about an Obsidian version.
     * @param appVersion Obsidian app version
     */
    async getVersionInfo(appVersion: string): Promise<ObsidianVersionInfo> {
        const versions = await this.getVersions();
        if (appVersion == "latest-beta") {
            appVersion = versions.at(-1)!.version;
        } else if (appVersion == "latest") {
            appVersion = versions.filter(v => !v.isBeta).at(-1)!.version;
        } else if (appVersion == "earliest") {
            appVersion = (await this.getRootManifest())?.minAppVersion;
            if (!appVersion) {
                throw Error('Unable to resolve Obsidian app appVersion "earliest", no manifest.json or minAppVersion found.')
            }
        } else {
            // if invalid match won't be found and we'll throw error below
            appVersion = semver.valid(appVersion) ?? appVersion;
        }
        const versionInfo = versions.find(v => v.version == appVersion);
        if (!versionInfo) {
            throw Error(`No Obsidian app version "${appVersion}" found`);
        }

        return versionInfo;
    }

    /**
     * Downloads the Obsidian installer for the given version and platform/arch (defaults to host platform/arch).
     * Returns the file path.
     * @param installerVersion Obsidian installer version to download
     * @param platform Platform/os of the installer to download (defaults to host platform)
     * @param arch Architecture of the installer to download (defaults to host architecture)
     */
    async downloadInstaller(
        installerVersion: string, platform?: NodeJS.Platform, arch?: NodeJS.Architecture,
    ): Promise<string> {
        platform = platform ?? process.platform;
        arch = arch ?? process.arch;
        const versionInfo = await this.getVersionInfo(installerVersion);
        installerVersion = versionInfo.version;
        const cacheDir = path.join(this.cacheDir, `obsidian-installer/${platform}-${arch}/Obsidian-${installerVersion}`);

        const installerUrl = this.getInstallerUrl(versionInfo, platform, arch);

        if (!installerUrl) {
            throw Error(`No Obsidian installer found for v${installerVersion} ${platform} ${arch}`);
        }

        let binaryPath: string;
        let extractor: (installer: string, dest: string) => Promise<void>;

        if (platform == "linux") {
            binaryPath = path.join(cacheDir, "obsidian");
            extractor = (installer, dest) => extractObsidianAppImage(installer, dest);
        } else if (platform == "win32") {
            binaryPath = path.join(cacheDir, "Obsidian.exe")
            extractor = (installer, dest) => extractObsidianExe(installer, arch, dest);
        } else if (platform == "darwin") {
            binaryPath = path.join(cacheDir, "Contents/MacOS/Obsidian");
            extractor = (installer, dest) => extractObsidianDmg(installer, dest);
        } else {
            throw Error(`Unsupported platform ${platform}`); // shouldn't happen
        }

        if (!(await fileExists(binaryPath))) {
            console.log(`Downloading Obsidian installer v${installerVersion}...`)
            await atomicCreate(cacheDir, async (tmpDir) => {
                const installer = path.join(tmpDir, "installer");
                await downloadResponse(await fetch(installerUrl), installer);
                const extracted = path.join(tmpDir, "extracted");
                await extractor(installer, extracted);
                return extracted;
            });
        }

        return binaryPath;
    }

    /** Gets the installer download url for the current platform, if one exists. */
    private getInstallerUrl(
        installerVersionInfo: ObsidianVersionInfo, platform: NodeJS.Platform, arch: NodeJS.Architecture,
    ): string|undefined {
        const platformName = `${platform}-${arch}`;
        const key = _.findKey(installerVersionInfo.installerInfo, v => v && v.platforms.includes(platformName));
        if (key) {
            return installerVersionInfo.downloads[key as keyof ObsidianVersionInfo['downloads']];
        }
    }

    /**
     * Downloads the Obsidian asar for the given version. Returns the file path.
     * 
     * To download beta versions you'll need to have an Obsidian account with Catalyst and set the `OBSIDIAN_USERNAME`
     * and `OBSIDIAN_PASSWORD` environment variables. 2FA needs to be disabled.
     * 
     * @param appVersion Obsidian version to download
     */
    async downloadApp(appVersion: string): Promise<string> {
        const appVersionInfo = await this.getVersionInfo(appVersion);
        const appUrl = appVersionInfo.downloads.asar;
        if (!appUrl) {
            throw Error(`No asar found for Obsidian version ${appVersion}`);
        }
        const appPath = path.join(this.cacheDir, 'obsidian-app', `obsidian-${appVersionInfo.version}.asar`);

        if (!(await fileExists(appPath))) {
            console.log(`Downloading Obsidian app v${appVersion} ...`)
            await atomicCreate(appPath, async (tmpDir) => {
                const isInsidersBuild = new URL(appUrl).hostname.endsWith('.obsidian.md');
                const response = isInsidersBuild ? await fetchObsidianAPI(appUrl) : await fetch(appUrl);
                const archive = path.join(tmpDir, 'app.asar.gz');
                const asar = path.join(tmpDir, 'app.asar')
                await downloadResponse(response, archive);
                await extractGz(archive, asar);
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
     * chromedriver since v115.0.5763.0 in that API, so wdio can't automatically download older versions of chromedriver
     * for old Electron versions. Here we download chromedriver for older versions ourselves using the @electron/get
     * package which fetches chromedriver from https://github.com/electron/electron/releases.
     * 
     * @param installerVersion Obsidian installer version
     */
    async downloadChromedriver(installerVersion: string): Promise<string> {
        const versionInfo = await this.getVersionInfo(installerVersion);
        const electronVersion = versionInfo.electronVersion;
        if (!electronVersion) {
            throw Error(`${installerVersion} is not an Obsidian installer version.`)
        }

        const {platform, arch} = process;
        const cacheDir = path.join(this.cacheDir, `electron-chromedriver/${platform}-${arch}/${electronVersion}`);
        let chromedriverPath: string;
        if (process.platform == "win32") {
            chromedriverPath = path.join(cacheDir, `chromedriver.exe`);
        } else {
            chromedriverPath = path.join(cacheDir, `chromedriver`);
        }

        if (!(await fileExists(chromedriverPath))) {
            console.log(`Downloading chromedriver for electron ${electronVersion} ...`);
            await atomicCreate(cacheDir, async (tmpDir) => {
                const chromedriverZipPath = await downloadArtifact({
                    version: electronVersion,
                    artifactName: 'chromedriver',
                    cacheRoot: path.join(tmpDir, 'download'),
                });
                const extracted = path.join(tmpDir, "extracted");
                await extractZip(chromedriverZipPath, { dir: extracted });
                return extracted;
            })
        }
        return chromedriverPath;
    }

    /** Gets the latest version of a plugin. */
    private async getLatestPluginVersion(repo: string) {
        repo = normalizeGitHubRepo(repo)
        const manifestUrl = `https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`;
        const cacheDest = path.join("obsidian-plugins", repo, "latest.json");
        const manifest = await this.cachedFetch(manifestUrl, cacheDest);
        return manifest.version;
    }

    /**
     * Downloads a plugin from a GitHub repo to the cache.
     * @param repo Repo
     * @param version Version of the plugin to install or "latest"
     * @returns path to the downloaded plugin
     */
    private async downloadGitHubPlugin(repo: string, version = "latest"): Promise<string> {
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
            await atomicCreate(pluginDir, async (tmpDir) => {
                const assetsToDownload = {'manifest.json': true, 'main.js': true, 'styles.css': false};
                await Promise.all(
                    Object.entries(assetsToDownload).map(async ([file, required]) => {
                        const url = `https://github.com/${repo}/releases/download/${version}/${file}`;
                        const response = await fetch(url);
                        if (response.ok) {
                            await downloadResponse(response, path.join(tmpDir, file));
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
    private async downloadCommunityPlugin(id: string, version = "latest"): Promise<string> {
        const communityPlugins = await this.getCommunityPlugins();
        const pluginInfo = communityPlugins.find(p => p.id == id);
        if (!pluginInfo) {
            throw Error(`No plugin with id ${id} found.`);
        }
        return await this.downloadGitHubPlugin(pluginInfo.repo, version);
    }

    /**
     * Downloads a list of plugins to the cache and returns a list of `DownloadedPluginEntry` with the downloaded paths.
     * Also adds the `id` property to the plugins based on the manifest.
     * 
     * You can download plugins from GitHub using `{repo: "org/repo"}` and community plugins using `{id: 'plugin-id'}`.
     * Local plugins will just be passed through.
     * 
     * @param plugins List of plugins to download.
     */
    async downloadPlugins(plugins: PluginEntry[]): Promise<DownloadedPluginEntry[]> {
        return await Promise.all(
            plugins.map(async (plugin) => {
                if (typeof plugin == "object" && "originalType" in plugin) {
                    return {...plugin as DownloadedPluginEntry}
                }
                let pluginPath: string
                let originalType: "local"|"github"|"community"
                if (typeof plugin == "string") {
                    pluginPath = path.resolve(plugin);
                    originalType = "local";
                } else if ("path" in plugin) {;
                    pluginPath = path.resolve(plugin.path);
                    originalType = "local";
                } else if ("repo" in plugin) {
                    pluginPath = await this.downloadGitHubPlugin(plugin.repo, plugin.version);
                    originalType = "github";
                } else if ("id" in plugin) {
                    pluginPath = await this.downloadCommunityPlugin(plugin.id, plugin.version);
                    originalType = "community";
                } else {
                    throw Error("You must specify one of plugin path, repo, or id")
                }

                const manifestPath = path.join(pluginPath, "manifest.json");
                if (!(await fileExists(manifestPath))) {
                    throw Error(`No plugin found at ${pluginPath}`)
                }
                let pluginId = (typeof plugin == "object" && ("id" in plugin)) ? plugin.id : undefined;
                if (!pluginId) {
                    pluginId = JSON.parse(await fsAsync.readFile(manifestPath, 'utf8').catch(() => "{}")).id;
                    if (!pluginId) {
                        throw Error(`${manifestPath} malformed.`);
                    }
                }
                if (!(await fileExists(path.join(pluginPath, "main.js")))) {
                    throw Error(`No main.js found under ${pluginPath}`)
                }

                let enabled: boolean
                if (typeof plugin == "string") {
                    enabled = true
                } else {
                    enabled = plugin.enabled ?? true;
                }
                return {path: pluginPath, id: pluginId, enabled, originalType}
            })
        );
    }

    /** Gets the latest version of a theme. */
    private async getLatestThemeVersion(repo: string) {
        repo = normalizeGitHubRepo(repo)
        const manifestUrl = `https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`;
        const cacheDest = path.join("obsidian-themes", repo, "latest.json");
        const manifest = await this.cachedFetch(manifestUrl, cacheDest);
        return manifest.version;
    }

    /**
     * Downloads a theme from a GitHub repo to the cache.
     * @param repo Repo
     * @returns path to the downloaded theme
     */
    private async downloadGitHubTheme(repo: string): Promise<string> {
        repo = normalizeGitHubRepo(repo)
        // Obsidian theme's are just pulled from the repo HEAD, not releases, so we can't really choose a specific 
        // version of a theme.
        // We use the manifest.json version to check if the theme has changed.
        const version = await this.getLatestThemeVersion(repo);
        const themeDir = path.join(this.cacheDir, "obsidian-themes", repo, version);

        if (!(await fileExists(themeDir))) {
            await atomicCreate(themeDir, async (tmpDir) => {
                const assetsToDownload = ['manifest.json', 'theme.css'];
                await Promise.all(
                    assetsToDownload.map(async (file) => {
                        const url = `https://raw.githubusercontent.com/${repo}/HEAD/${file}`;
                        const response = await fetch(url);
                        if (response.ok) {
                            await downloadResponse(response, path.join(tmpDir, file));
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
    private async downloadCommunityTheme(name: string): Promise<string> {
        const communityThemes = await this.getCommunityThemes();
        const themeInfo = communityThemes.find(p => p.name == name);
        if (!themeInfo) {
            throw Error(`No theme with name ${name} found.`);
        }
        return await this.downloadGitHubTheme(themeInfo.repo);
    }

    /**
     * Downloads a list of themes to the cache and returns a list of `DownloadedThemeEntry` with the downloaded paths.
     * Also adds the `name` property to the plugins based on the manifest.
     * 
     * You can download themes from GitHub using `{repo: "org/repo"}` and community themes using `{name: 'theme-name'}`.
     * Local themes will just be passed through.
     * 
     * @param themes List of themes to download
     */
    async downloadThemes(themes: ThemeEntry[]): Promise<DownloadedThemeEntry[]> {
        return await Promise.all(
            themes.map(async (theme) => {
                if (typeof theme == "object" && "originalType" in theme) {
                    return {...theme as DownloadedThemeEntry}
                }
                let themePath: string
                let originalType: "local"|"github"|"community"
                if (typeof theme == "string") {
                    themePath = path.resolve(theme);
                    originalType = "local";
                } else if ("path" in theme) {;
                    themePath = path.resolve(theme.path);
                    originalType = "local";
                } else if ("repo" in theme) {
                    themePath = await this.downloadGitHubTheme(theme.repo);
                    originalType = "github";
                } else if ("name" in theme) {
                    themePath = await this.downloadCommunityTheme(theme.name);
                    originalType = "community";
                } else {
                    throw Error("You must specify one of theme path, repo, or name")
                }

                const manifestPath = path.join(themePath, "manifest.json");
                if (!(await fileExists(manifestPath))) {
                    throw Error(`No theme found at ${themePath}`)
                }
                let themeName = (typeof theme == "object" && ("name" in theme)) ? theme.name : undefined;
                if (!themeName) {
                    const manifestPath = path.join(themePath, "manifest.json");
                    themeName = JSON.parse(await fsAsync.readFile(manifestPath, 'utf8').catch(() => "{}")).name;
                    if (!themeName) {
                        throw Error(`${themePath}/manifest.json malformed.`);
                    }
                }
                if (!(await fileExists(path.join(themePath, "theme.css")))) {
                    throw Error(`No theme.css found under ${themePath}`)
                }

                let enabled: boolean
                if (typeof theme == "string") {
                    enabled = true
                } else {
                    enabled = theme.enabled ?? true;
                }
                return {path: themePath, name: themeName, enabled: enabled, originalType};
            })
        );
    }

    /**
     * Installs plugins into an Obsidian vault
     * @param vault Path to the vault to install the plugins in
     * @param plugins List plugins to install
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

        for (const {path: pluginPath, enabled = true, originalType} of downloadedPlugins) {
            const manifestPath = path.join(pluginPath, 'manifest.json');
            const pluginId = JSON.parse(await fsAsync.readFile(manifestPath, 'utf8').catch(() => "{}")).id;
            if (!pluginId) {
                throw Error(`${manifestPath} missing or malformed.`);
            }

            const pluginDest = path.join(obsidianDir, 'plugins', pluginId);
            await fsAsync.mkdir(pluginDest, { recursive: true });

            const files: Record<string, [boolean, boolean]> = {
                "manifest.json": [true, true],
                "main.js": [true, true],
                "styles.css": [false, true],
                "data.json": [false, false],
            }
            for (const [file, [required, deleteIfMissing]] of Object.entries(files)) {
                if (await fileExists(path.join(pluginPath, file))) {
                    await linkOrCp(path.join(pluginPath, file), path.join(pluginDest, file));
                } else if (required) {
                    throw Error(`${pluginPath}/${file} missing.`);
                } else if (deleteIfMissing) {
                    await fsAsync.rm(path.join(pluginDest, file), {force: true});
                }
            }

            const pluginAlreadyListed = enabledPlugins.includes(pluginId);
            if (enabled && !pluginAlreadyListed) {
                enabledPlugins.push(pluginId)
            } else if (!enabled && pluginAlreadyListed) {
                enabledPlugins = enabledPlugins.filter(p => p != pluginId);
            }

            if (originalType == "local") {
                // Add a .hotreload file for the https://github.com/pjeby/hot-reload plugin
                await fsAsync.writeFile(path.join(pluginDest, '.hotreload'), '');
            }
        }

        if (!_.isEqual(enabledPlugins, originalEnabledPlugins)) {
            await fsAsync.writeFile(enabledPluginsPath, JSON.stringify(enabledPlugins, undefined, 2));
        }
    }

    /** 
     * Installs themes into an Obsidian vault
     * @param vault Path to the theme to install the themes in
     * @param themes List of themes to install
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
     * Sets up the config dir to use for the `--user-data-dir` in obsidian. Returns the path to the created config dir.
     *
     * @param params.appVersion Obsidian app version
     * @param params.installerVersion Obsidian version string.
     * @param params.appPath Path to the asar file to install. Will download if omitted.
     * @param params.vault Path to the vault to open in Obsidian.
     * @param params.localStorage items to add to localStorage. `$vaultId` in the keys will be replaced with the vaultId
     */
    async setupConfigDir(params: {
        appVersion: string, installerVersion: string,
        appPath?: string,
        vault?: string,
        localStorage?: Record<string, string>,
    }): Promise<string> {
        const [appVersion, installerVersion] = await this.resolveVersions(params.appVersion, params.installerVersion);
        // configDir will be passed to --user-data-dir, so Obsidian is somewhat sandboxed. We set up "obsidian.json" so
        // that Obsidian opens the vault by default and doesn't check for updates.
        const configDir = await makeTmpDir('obs-launcher-config-');
    
        let obsidianJson: any = {
            updateDisabled: true, // Prevents Obsidian trying to auto-update on boot.
        }
        const localStorageData: Record<string, string> = {
            "most-recently-installed-version": appVersion, // prevents the changelog page on boot
        }

        let vaultId: string|undefined = undefined;
        if (params.vault !== undefined) {
            if (!await fileExists(params.vault)) {
                throw Error(`Vault path ${params.vault} doesn't exist.`)
            }
            vaultId = crypto.randomBytes(8).toString("hex");
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
            Object.assign(localStorageData, {
                [`enable-plugin-${vaultId}`]: "true", // Disable "safe mode" and enable plugins
            })
        }
        Object.assign(localStorageData, _.mapKeys(params.localStorage ?? {},
            (v, k) => k.replace('$vaultId', vaultId ?? ''),
        ));

        await fsAsync.writeFile(path.join(configDir, 'obsidian.json'), JSON.stringify(obsidianJson));

        let appPath = params.appPath;
        if (!appPath) {
            appPath = await this.downloadApp(appVersion);
        }
        await linkOrCp(appPath, path.join(configDir, path.basename(appPath)));

        const localStorage = new ChromeLocalStorage(configDir);
        await localStorage.setItems("app://obsidian.md", localStorageData)
        await localStorage.close();

        return configDir;
    }

    /**
     * Sets up a vault for Obsidian, installing plugins and themes and optionally copying the vault to a temporary
     * directory first.
     * @param params.vault Path to the vault to open in Obsidian
     * @param params.copy Whether to copy the vault to a tmpdir first. Default false
     * @param params.plugins List of plugins to install in the vault
     * @param params.themes List of themes to install in the vault
     * @returns Path to the copied vault (or just the path to the vault if copy is false)
     */
    async setupVault(params: {
        vault: string,
        copy?: boolean,
        plugins?: PluginEntry[], themes?: ThemeEntry[],
    }): Promise<string> {
        let vault = params.vault;
        if (params.copy) {
            const dest = await makeTmpDir(`${path.basename(vault)}-`);
            await fsAsync.cp(vault, dest, { recursive: true, preserveTimestamps: true });
            vault = dest;
        }
        await this.installPlugins(vault, params.plugins ?? []);
        await this.installThemes(vault, params.themes ?? []);

        return vault;
    }

    /**
     * Downloads and launches Obsidian with a sandboxed config dir and a specifc vault open. Optionally install plugins
     * and themes first.
     * 
     * This is just a shortcut for calling `downloadApp`, `downloadInstaller`, `setupVault` and `setupConfDir`.
     *
     * @param params.appVersion Obsidian app version. Default "latest"
     * @param params.installerVersion Obsidian installer version. Default "latest"
     * @param params.vault Path to the vault to open in Obsidian
     * @param params.copy Whether to copy the vault to a tmpdir first. Default false
     * @param params.plugins List of plugins to install in the vault
     * @param params.themes List of themes to install in the vault
     * @param params.args CLI args to pass to Obsidian
     * @param params.localStorage items to add to localStorage. `$vaultId` in the keys will be replaced with the vaultId
     * @param params.spawnOptions Options to pass to `spawn`
     * @returns The launched child process and the created tmpdirs
     */
    async launch(params: {
        appVersion?: string, installerVersion?: string,
        copy?: boolean,
        vault?: string,
        plugins?: PluginEntry[], themes?: ThemeEntry[],
        args?: string[],
        localStorage?: Record<string, string>,
        spawnOptions?: child_process.SpawnOptions,
    }): Promise<{proc: child_process.ChildProcess, configDir: string, vault?: string}> {
        const [appVersion, installerVersion] = await this.resolveVersions(
            params.appVersion ?? "latest",
            params.installerVersion ?? "latest",
        );
        const appPath = await this.downloadApp(appVersion);
        const installerPath = await this.downloadInstaller(installerVersion);

        let vault = params.vault;
        if (vault) {
            vault = await this.setupVault({
                vault,
                copy: params.copy ?? false,
                plugins: params.plugins, themes: params.themes,
            })
        }

        const configDir = await this.setupConfigDir({
            appVersion, installerVersion, appPath, vault,
            localStorage: params.localStorage,
        });

        // Spawn child.
        const proc = child_process.spawn(installerPath, [
            `--user-data-dir=${configDir}`,
            // Workaround for SUID issue on linux. See https://github.com/electron/electron/issues/42510
            ...(process.platform == 'linux' ? ["--no-sandbox"] : []),
            ...(params.args ?? []),
        ], {
            ...params.spawnOptions,
        });

        return {proc, configDir, vault};
    }

    /** 
     * Updates the info in obsidian-versions.json. The obsidian-versions.json file is used in other launcher commands
     * and in wdio-obsidian-service to get metadata about Obsidian versions in one place such as minInstallerVersion and
     * the internal electron version.
     */
    async updateObsidianVersionList(
        original?: ObsidianVersionInfos, { maxInstances = 1 } = {},
    ): Promise<ObsidianVersionInfos> {
        const repo = 'obsidianmd/obsidian-releases';

        let commitHistory = await fetchGitHubAPIPaginated(`repos/${repo}/commits`, {
            path: "desktop-releases.json",
            since: original?.metadata.commitDate,
        });
        commitHistory.reverse();
        if (original) {
            commitHistory = _.takeRightWhile(commitHistory, c => c.sha != original.metadata.commitSha);
        }
    
        const fileHistory: any[] = await pool(8, commitHistory, commit =>
            fetch(`https://raw.githubusercontent.com/${repo}/${commit.sha}/desktop-releases.json`).then(r => r.json())
        );
    
        const githubReleases = await fetchGitHubAPIPaginated(`repos/${repo}/releases`);
    
        let versionMap: _.Dictionary<Partial<ObsidianVersionInfo>> = _.keyBy(
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

        // get all installers we need to extract info for
        const newInstallers = Object.values(versionMap)
            .filter(v => v.downloads?.appImage && !v.installerInfo)
            .flatMap(v => [[v, "appImage"], [v, "appImageArm"], [v, "dmg"], [v, "exe"]] as const)
            .filter(([v, key]) => !!v.downloads![key]);
        const installerInfos = await pool(maxInstances, newInstallers, async ([v, key]) => {
            const installerInfo = await getInstallerInfo(key, v.downloads![key]!);
            return [v.version!, key, installerInfo] as const;
        });

        for (const [version, key, installerInfo] of installerInfos) {
            versionMap[version].installerInfo = versionMap[version].installerInfo ?? {};
            versionMap[version].installerInfo[key] = installerInfo;
        }
    
        // populate minInstallerVersion and maxInstallerVersion and add corrections
        let minInstallerVersion: string|undefined = undefined;
        let maxInstallerVersion: string|undefined = undefined;
        for (const version of Object.keys(versionMap).sort(semver.compare)) {
            // older versions have 0.0.0 as there min version, which doesn't exist anywhere we can download.
            // we'll set those to the first available installer version.
            if (!minInstallerVersion && versionMap[version].chromeVersion) {
                minInstallerVersion = version;
            }
            if (versionMap[version].downloads!.appImage) {
                maxInstallerVersion = version;
            }
            versionMap[version] = mergeKeepUndefined({}, versionMap[version],
                {
                    minInstallerVersion: versionMap[version].minInstallerVersion ?? minInstallerVersion,
                    maxInstallerVersion: maxInstallerVersion,
                },
                correctObsidianVersionInfo(versionMap[version]),
            );
        }
    
        const result: ObsidianVersionInfos = {
            metadata: {
                schemaVersion: "v1",
                commitDate: commitHistory.at(-1)?.commit.committer.date ?? original?.metadata.commitDate,
                commitSha: commitHistory.at(-1)?.sha ?? original?.metadata.commitSha,
                timestamp: original?.metadata.timestamp ?? "", // set down below
            },
            versions: Object.values(versionMap)
                .map(normalizeObsidianVersionInfo)
                .sort((a, b) => semver.compare(a.version, b.version)),
        }

        // Update timestamp if anything has changed. Also, GitHub will cancel scheduled workflows if the repository is
        // "inactive" for 60 days. So we'll update the timestamp every once in a while even if there are no Obsidian
        // updates to make sure there's commit activity in the repo.
        const dayMs = 24 * 60 * 60 * 1000;
        const timeSinceLastUpdate = new Date().getTime() - new Date(original?.metadata.timestamp ?? 0).getTime();
        if (!_.isEqual(original, result) || timeSinceLastUpdate > 29 * dayMs) {
            result.metadata.timestamp = new Date().toISOString();
        }

        return result;
    }

    /**
     * Returns true if the Obsidian version is already in the cache.
     * @param type on of "app" or "installer"
     * @param version Obsidian app/installer version
     */
    async isInCache(type: "app"|"installer", version: string) {
        version = (await this.getVersionInfo(version)).version;

        let dest: string
        if (type == "app") {
            dest = `obsidian-app/obsidian-${version}.asar`;
        } else { // type == "installer"
            const {platform, arch} = process;
            dest =`obsidian-installer/${platform}-${arch}/Obsidian-${version}`;
        }

        return (await fileExists(path.join(this.cacheDir, dest)));
    }

    /**
     * Returns true if we either have the credentials to download the version or it's already in cache.
     * This is only relevant for Obsidian beta versions, as they require Obsidian insider credentials to download.
     * @param appVersion Obsidian app version
     */
    async isAvailable(appVersion: string): Promise<boolean> {
        const versionInfo = await this.getVersionInfo(appVersion);
        const versionExists = !!(versionInfo.downloads.asar && versionInfo.minInstallerVersion)

        if (versionInfo.isBeta) {
            const hasCreds = !!(process.env['OBSIDIAN_USERNAME'] && process.env['OBSIDIAN_PASSWORD']);
            const inCache = await this.isInCache('app', versionInfo.version);
            return versionExists && (hasCreds || inCache);
        } else {
            return versionExists;
        }
    }
}
