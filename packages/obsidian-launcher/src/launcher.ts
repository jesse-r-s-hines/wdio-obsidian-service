import fsAsync from "fs/promises"
import path from "path"
import crypto from "crypto";
import extractZip from "extract-zip"
import { downloadArtifact } from '@electron/get';
import child_process from "child_process"
import semver from "semver"
import { fileURLToPath } from "url";
import _ from "lodash"
import dotenv from "dotenv";
import { fileExists, makeTmpDir, atomicCreate, linkOrCp, maybe, pool } from "./utils.js";
import {
    ObsidianVersionInfo, ObsidianVersionList, ObsidianInstallerInfo, PluginEntry, DownloadedPluginEntry, ThemeEntry,
    DownloadedThemeEntry, obsidianVersionsSchemaVersion,
} from "./types.js";
import { ObsidianAppearanceConfig, ObsidianCommunityPlugin, ObsidianCommunityTheme, PluginManifest } from "./obsidianTypes.js";
import { obsidianApiLogin, fetchObsidianApi, downloadResponse } from "./apis.js";
import ChromeLocalStorage from "./chromeLocalStorage.js";
import {
    normalizeGitHubRepo, extractGz, extractObsidianAppImage, extractObsidianExe, extractObsidianDmg,
    extractInstallerInfo, fetchObsidianDesktopReleases, fetchObsidianGitHubReleases, updateObsidianVersionList,
    INSTALLER_KEYS,
} from "./launcherUtils.js";

const currentPlatform = {
    platform: process.platform,
    arch: process.arch,
}

dotenv.config({path: [".env"], quiet: true});

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

    readonly interactive: boolean = false;
    private obsidianApiToken: string|undefined;

    /**
     * Construct an ObsidianLauncher.
     * @param opts.cacheDir Path to the cache directory. Defaults to "OBSIDIAN_CACHE" env var or ".obsidian-cache".
     * @param opts.versionsUrl Custom `obsidian-versions.json` url. Can be a file URL.
     * @param opts.communityPluginsUrl Custom `community-plugins.json` url. Can be a file URL.
     * @param opts.communityThemesUrl Custom `community-css-themes.json` url. Can be a file URL.
     * @param opts.cacheDuration If the cached version list is older than this (in ms), refetch it. Defaults to 30 minutes.
     * @param opts.interactive If it can prompt the user for input (e.g. for Obsidian credentials). Default false.
     */
    constructor(opts: {
        cacheDir?: string,
        versionsUrl?: string,
        communityPluginsUrl?: string,
        communityThemesUrl?: string,
        cacheDuration?: number,
        interactive?: boolean,
    } = {}) {
        this.cacheDir = path.resolve(opts.cacheDir ?? process.env.OBSIDIAN_CACHE ?? "./.obsidian-cache");
        
        const defaultVersionsUrl =  'https://raw.githubusercontent.com/jesse-r-s-hines/wdio-obsidian-service/HEAD/obsidian-versions.json'
        this.versionsUrl = opts.versionsUrl ?? defaultVersionsUrl;
        
        const defaultCommunityPluginsUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";
        this.communityPluginsUrl = opts.communityPluginsUrl ?? defaultCommunityPluginsUrl;

        const defaultCommunityThemesUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json";
        this.communityThemesUrl = opts.communityThemesUrl ?? defaultCommunityThemesUrl;

        this.cacheDuration = opts.cacheDuration ?? (30 * 60 * 1000);
        this.interactive = opts.interactive ?? false;

        this.metadataCache = {};
    }

    /**
     * Returns file content fetched from url as JSON. Caches content to dest and uses that cache if its more recent than
     * cacheDuration ms or if there are network errors.
     */
    private async cachedFetch(url: string, dest: string, cacheValid?: (data: any) => boolean): Promise<any> {
        cacheValid = cacheValid ?? (() => true);
        dest = path.join(this.cacheDir, dest);

        if (!(dest in this.metadataCache)) {
            let data: any;
            let error: any;
            const cacheMtime = (await fsAsync.stat(dest).catch(() => undefined))?.mtime;

            // read file urls directly
            if (url.startsWith("file:")) {
                data = JSON.parse(await fsAsync.readFile(fileURLToPath(url), 'utf-8'));
            }
            // read from cache if its recent and valid
            if (!data && cacheMtime && new Date().getTime() - cacheMtime.getTime() < this.cacheDuration) {
                const parsed = JSON.parse(await fsAsync.readFile(dest, 'utf-8'));
                if (cacheValid(parsed)) {
                    data = parsed;
                }
            }
            // otherwise try to fetch the url
            if (!data) {
                const response = await maybe(fetch(url).then(async (r) => {
                    if (!r.ok) throw Error(`Fetch ${url} failed with status ${r.status}`);
                    const d = await r.text();
                    // throw if invalid JSON, but keep original formatting
                    if (_.isError(_.attempt(JSON.parse, d))) throw Error(`Failed to parse response from ${url}`);
                    return d;
                }));
                if (response.success) {
                    await atomicCreate(dest, async (tmpDir) => {
                        await fsAsync.writeFile(path.join(tmpDir, 'download.json'), response.result);
                        return path.join(tmpDir, 'download.json');
                    });
                    data = JSON.parse(response.result);
                } else {
                    error = response.error;
                }
            }
            // use cache on network error, even if old
            if (!data && (await fileExists(dest))) {
                const parsed = JSON.parse(await fsAsync.readFile(dest, 'utf-8'));
                if (cacheValid(parsed)) {
                    console.warn(error)
                    console.warn(`Unable to download ${url}, using cached file.`);
                    data = parsed;
                }
            }
            if (!data) {
                throw error;
            }

            this.metadataCache[dest] = data;
        }
        return this.metadataCache[dest];
    }

    /**
     * Get parsed content of the current project's manifest.json
     */
    private async getRootManifest(): Promise<PluginManifest|null> {
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
        const isValid = (d: ObsidianVersionList) =>
            semver.satisfies(d.metadata.schemaVersion ?? '1.0.0', `^${obsidianVersionsSchemaVersion}`);
        const versions = await this.cachedFetch(this.versionsUrl, "obsidian-versions.json", isValid);
        if (!isValid(versions)) {
            throw new Error(`${this.versionsUrl} format has changed, please update obsidian-launcher and wdio-obsidian-service`)
        }
        return versions.versions;
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
     * @param appVersion specific version or one of
     *   - "latest": Get the current latest non-beta Obsidian version
     *   - "latest-beta": Get the current latest beta Obsidian version (or latest is there is no current beta)
     *   - "earliest": Get the `minAppVersion` set in your `manifest.json`
     * @param installerVersion specific version or one of
     *   - "latest": Get the latest Obsidian installer compatible with `appVersion`
     *   - "earliest": Get the oldest Obsidian installer compatible with `appVersion`
     * 
     * See also: [Obsidian App vs Installer Versions](../README.md#obsidian-app-vs-installer-versions)
     *
     * @returns [appVersion, installerVersion] with any "latest" etc. resolved to specific versions.
     */
    async resolveVersion(appVersion: string, installerVersion = "latest"): Promise<[string, string]> {
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
                semver.lte(v.version, appVersionInfo.version) && !!this.getInstallerKey(v, {platform, arch})
            );
        } else if (installerVersion == "earliest") {
            installerVersionInfo = versions.find(v =>
                semver.gte(v.version, appVersionInfo.minInstallerVersion!) && !!this.getInstallerKey(v, {platform, arch})
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
            const manifest = await this.getRootManifest();
            if (!manifest?.minAppVersion) {
                throw Error('Unable to resolve Obsidian appVersion "earliest", no manifest.json or minAppVersion found.')
            }
            appVersion = manifest.minAppVersion;
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
     * Parses a string of Obsidian versions into [appVersion, installerVersion] tuples.
     * 
     * `versions` should be a space separated list of Obsidian app versions. You can optionally specify the installer
     * version by using "appVersion/installerVersion" e.g. `"1.7.7/1.8.10"`.
     * 
     * Example: 
     * ```js
     * launcher.parseVersions("1.8.10/1.7.7 latest latest-beta/earliest")
     * ```
     * 
     * See also: [Obsidian App vs Installer Versions](../README.md#obsidian-app-vs-installer-versions)
     * 
     * @param versions string to parse
     * @returns [appVersion, installerVersion][] resolved to specific versions.
     */
    async parseVersions(versions: string): Promise<[string, string][]> {
        const parsedVersions = versions.split(/[ ,]/).filter(v => v).map((v) => {
            const [appVersion, installerVersion = 'earliest'] = v.split("/");
            return [appVersion, installerVersion] as [string, string];
        });
        const resolvedVersions: [string, string][] = [];
        for (const [appVersion, installerVersion] of parsedVersions) {
            resolvedVersions.push(await this.resolveVersion(appVersion, installerVersion));
        }
        return _.uniqBy(resolvedVersions, v => v.join('/'));
    }

    private getInstallerKey(
        installerVersionInfo: ObsidianVersionInfo,
        opts: {platform?: NodeJS.Platform, arch?: NodeJS.Architecture} = {},
    ): keyof ObsidianVersionInfo['installers']|undefined {
        const {platform, arch} = _.defaults({}, opts, currentPlatform);
        const platformName = `${platform}-${arch}`;
        const key = _.findKey(installerVersionInfo.installers, v => v && v.platforms.includes(platformName));
        return key as keyof ObsidianVersionInfo['installers']|undefined;
    }

    /**
     * Gets details about the Obsidian installer for the given platform.
     * @param installerVersion Obsidian installer version
     * @param opts.platform Platform/os (defaults to host platform)
     * @param opts.arch Architecture (defaults to host architecture)
     */
    async getInstallerInfo(
        installerVersion: string,
        opts: {platform?: NodeJS.Platform, arch?: NodeJS.Architecture} = {},
    ): Promise<ObsidianInstallerInfo & {url: string}> {
        const {platform, arch} = _.defaults({}, opts, currentPlatform);
        const versionInfo = await this.getVersionInfo(installerVersion);
        const key = this.getInstallerKey(versionInfo, {platform, arch});
        if (key) {
            return {...versionInfo.installers[key]!, url: versionInfo.downloads[key]!};
        } else {
            throw Error(
                `No Obsidian installer for ${installerVersion} ${platform}-${arch}` +
                (versionInfo.isBeta ? ` (${installerVersion} is a beta version)` : '')
            );
        }
    }

    /**
     * Downloads the Obsidian installer for the given version and platform/arch (defaults to host platform/arch).
     * Returns the file path.
     * @param installerVersion Obsidian installer version to download
     * @param opts.platform Platform/os of the installer to download (defaults to host platform)
     * @param opts.arch Architecture of the installer to download (defaults to host architecture)
     */
    async downloadInstaller(
        installerVersion: string,
        opts: {platform?: NodeJS.Platform, arch?: NodeJS.Architecture} = {},
    ): Promise<string> {
        const {platform, arch} = _.defaults({}, opts, currentPlatform);
        const versionInfo = await this.getVersionInfo(installerVersion);
        installerVersion = versionInfo.version;
        const installerInfo = await this.getInstallerInfo(installerVersion, {platform, arch});
        const cacheDir = path.join(this.cacheDir, `obsidian-installer/${platform}-${arch}/Obsidian-${installerVersion}`);

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
                await downloadResponse(await fetch(installerInfo.url), installer);
                const extracted = path.join(tmpDir, "extracted");
                await extractor(installer, extracted);
                return extracted;
            });
        }

        return binaryPath;
    }

    /**
     * Downloads the Obsidian asar for the given version. Returns the file path.
     * 
     * To download Obsidian beta versions you'll need to have an Obsidian Insiders account and either set the 
     * `OBSIDIAN_EMAIL` and `OBSIDIAN_PASSWORD` env vars (`.env` file is supported) or pre-download the Obsidian beta
     * with `npx obsidian-launcher download app -v latest-beta`
     * 
     * @param appVersion Obsidian version to download
     */
    async downloadApp(appVersion: string): Promise<string> {
        const versionInfo = await this.getVersionInfo(appVersion);
        const appUrl = versionInfo.downloads.asar;
        if (!appUrl) {
            throw Error(`No asar found for Obsidian version ${appVersion}`);
        }
        const appPath = path.join(this.cacheDir, 'obsidian-app', `obsidian-${versionInfo.version}.asar`);

        if (!(await fileExists(appPath))) {
            console.log(`Downloading Obsidian app v${versionInfo.version} ...`)
            await atomicCreate(appPath, async (tmpDir) => {
                const isInsiders = new URL(appUrl).hostname.endsWith('.obsidian.md');
                let response: Response;
                if (isInsiders) {
                    if (!this.obsidianApiToken) {
                        this.obsidianApiToken = await obsidianApiLogin({
                            interactive: this.interactive,
                            savePath: path.join(this.cacheDir, "obsidian-credentials.env"),
                        });
                    }
                    response = await fetchObsidianApi(appUrl, {token: this.obsidianApiToken});
                } else {
                    response = await fetch(appUrl);
                }
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
    async downloadChromedriver(
        installerVersion: string,
        opts: {platform?: NodeJS.Platform, arch?: NodeJS.Architecture} = {},
    ): Promise<string> {
        const {platform, arch} = _.defaults({}, opts, currentPlatform);
        const installerInfo = await this.getInstallerInfo(installerVersion, {platform, arch});
        const cacheDir = path.join(this.cacheDir, `electron-chromedriver/${platform}-${arch}/${installerInfo.electron}`);
        let chromedriverPath: string;
        if (process.platform == "win32") {
            chromedriverPath = path.join(cacheDir, `chromedriver.exe`);
        } else {
            chromedriverPath = path.join(cacheDir, `chromedriver`);
        }

        if (!(await fileExists(chromedriverPath))) {
            console.log(`Downloading chromedriver for electron ${installerInfo.electron} ...`);
            await atomicCreate(cacheDir, async (tmpDir) => {
                const chromedriverZipPath = await downloadArtifact({
                    version: installerInfo.electron,
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

    /**
     * Downloads the Obsidian apk.
     */
    async downloadAndroid(version: string): Promise<string> {
        const versionInfo = await this.getVersionInfo(version);
        const apkUrl = versionInfo.downloads.apk;
        if (!apkUrl) {
            throw Error(
                `No apk found for Obsidian version ${version}` +
                (versionInfo.isBeta ? ` (${version} is a beta version)` : '')
            );
        }
        const apkPath = path.join(this.cacheDir, 'obsidian-apk', `obsidian-${versionInfo.version}.apk`);

        if (!(await fileExists(apkPath))) {
            console.log(`Downloading Obsidian apk v${versionInfo.version} ...`)
            await atomicCreate(apkPath, async (tmpDir) => {
                const dest = path.join(tmpDir, 'obsidian.apk')
                await downloadResponse(await fetch(apkUrl), dest);
                return dest;
            })
        }

        return apkPath;
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
     * Downloads a list of plugins to the cache and returns a list of {@link DownloadedPluginEntry} with the downloaded
     * paths. Also adds the `id` property to the plugins based on the manifest.
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

            const files = {
                "manifest.json": true,
                "main.js": true,
                "styles.css": false,
            }
            for (const [file, required] of Object.entries(files)) {
                if (await fileExists(path.join(pluginPath, file))) {
                    await linkOrCp(path.join(pluginPath, file), path.join(pluginDest, file));
                } else if (required) {
                    throw Error(`${pluginPath}/${file} missing.`);
                } else {
                    await fsAsync.rm(path.join(pluginDest, file), {force: true});
                }
            }
            if (await fileExists(path.join(pluginPath, "data.json"))) {
                // don't link data.json since it can be modified. Don't delete it if it already exists.
                await fsAsync.cp(path.join(pluginPath, "data.json"), path.join(pluginDest, "data.json"));
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
    private async downloadGitHubTheme(repo: string, version = "latest"): Promise<string> {
        repo = normalizeGitHubRepo(repo)
        const latest = await this.getLatestThemeVersion(repo);
        if (version == "latest") {
            version = latest;
        }
        if (!semver.valid(version)) {
            throw Error(`Invalid version "${version}"`);
        }
        version = semver.valid(version)!;
        
        const themeDir = path.join(this.cacheDir, "obsidian-themes", repo, version);

        if (!(await fileExists(themeDir))) {
            await atomicCreate(themeDir, async (tmpDir) => {
                // Obsidian themes can be downloaded from releases like plugins, but have fallback "legacy" behavior
                // that just downloads from repo HEAD directly.
                const assetsToDownload = ['manifest.json', 'theme.css'];
                let baseUrl = `https://github.com/${repo}/releases/download/${version}`;
                if (!(await fetch(`${baseUrl}/manifest.json`)).ok) {
                    if (version != latest) {
                        throw Error(`No theme version "${version}" found`);
                    }
                    baseUrl = `https://raw.githubusercontent.com/${repo}/HEAD`;
                }
                await Promise.all(
                    assetsToDownload.map(async (file) => {
                        const url = `${baseUrl}/${file}`;
                        const response = await fetch(url);
                            if (response.ok) {
                            await downloadResponse(response, path.join(tmpDir, file));
                        } else {
                            throw Error(`No ${file} found for ${repo}`);
                        }
                    }
                ))
            });
        }

        return themeDir;
    }

    /**
     * Downloads a community theme to the cache.
     * @param name name of the theme
     * @returns path to the downloaded theme
     */
    private async downloadCommunityTheme(name: string, version = "latest"): Promise<string> {
        const communityThemes = await this.getCommunityThemes();
        const themeInfo = communityThemes.find(p => p.name == name);
        if (!themeInfo) {
            throw Error(`No theme with name ${name} found.`);
        }
        return await this.downloadGitHubTheme(themeInfo.repo, version);
    }

    /**
     * Downloads a list of themes to the cache and returns a list of {@link DownloadedThemeEntry} with the downloaded
     * paths. Also adds the `name` property to the plugins based on the manifest.
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
                    themePath = await this.downloadGitHubTheme(theme.repo, theme.version);
                    originalType = "github";
                } else if ("name" in theme) {
                    themePath = await this.downloadCommunityTheme(theme.name, theme.version);
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
            let appearance: ObsidianAppearanceConfig = {}
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
     * @param params.vault Path to the vault to open in Obsidian
     * @param params.localStorage items to add to localStorage. `$vaultId` in the keys will be replaced with the vaultId
     * @param params.chromePreferences Chrome preferences to add to the Preferences file
     */
    async setupConfigDir(params: {
        appVersion: string, installerVersion: string,
        appPath?: string,
        vault?: string,
        localStorage?: Record<string, string>,
        chromePreferences?: Record<string, any>,
    }): Promise<string> {
        const [appVersion, installerVersion] = await this.resolveVersion(params.appVersion, params.installerVersion);
        const configDir = await makeTmpDir('obsidian-launcher-config-');
        const vaultId = crypto.randomBytes(8).toString("hex");
    
        const localStorageData: Record<string, string> = {
            "most-recently-installed-version": appVersion, // prevents the changelog page on boot
            [`enable-plugin-${vaultId}`]: "true", // Disable "safe mode" and enable plugins
            ..._.mapKeys(params.localStorage ?? {}, (v, k) => k.replace('$vaultId', vaultId ?? '')),
        }
        const chromePreferences = _.merge(
            // disables the "allow pasting" bit in the dev tools console
            {"electron": {"devtools": {"preferences": {"disable-self-xss-warning": "true"}}}},
            params.chromePreferences ?? {},
        )
        const obsidianJson: any = {
            updateDisabled: true, // prevents Obsidian trying to auto-update on boot.
        }

        if (params.vault !== undefined) {
            if (!await fileExists(params.vault)) {
                throw Error(`Vault path ${params.vault} doesn't exist.`)
            }
            Object.assign(obsidianJson, {
                vaults: {
                    [vaultId]: {
                        path: path.resolve(params.vault),
                        ts: new Date().getTime(),
                        open: true,
                    },
                },
            });
        }

        await fsAsync.writeFile(path.join(configDir, 'obsidian.json'), JSON.stringify(obsidianJson));
        await fsAsync.writeFile(path.join(configDir, 'Preferences'), JSON.stringify(chromePreferences));

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
        const [appVersion, installerVersion] = await this.resolveVersion(
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
     * the internal Electron version.
     */
    async updateVersionList(
        original?: ObsidianVersionList, opts: { maxInstances?: number } = {},
    ): Promise<ObsidianVersionList> {
        const { maxInstances = 1 } = opts;

        const [destkopReleases, commitInfo] = await fetchObsidianDesktopReleases(
            original?.metadata.commitDate, original?.metadata.commitSha,
        );
        const gitHubReleases = await fetchObsidianGitHubReleases();
        let newVersions = updateObsidianVersionList({
            original: original?.versions,
            destkopReleases, gitHubReleases,
        });

        // extract installer info
        const newInstallers = newVersions
            .flatMap(v => INSTALLER_KEYS.map(k => [v, k] as const))
            .filter(([v, key]) => v.downloads?.[key] && !v.installers?.[key]?.chrome);
        const installerInfos = await pool(maxInstances, newInstallers, async ([v, key]) => {
            const installerInfo = await extractInstallerInfo(key, v.downloads[key]!);
            return {version: v.version, key, installerInfo};
        });

        // update again with the installerInfo
        newVersions = updateObsidianVersionList({original: newVersions, installerInfos});

        const result: ObsidianVersionList = {
            metadata: {
                schemaVersion: obsidianVersionsSchemaVersion,
                commitDate: commitInfo.commitDate,
                commitSha: commitInfo.commitSha,
                timestamp: original?.metadata.timestamp ?? "", // set down below
            },
            versions: newVersions,
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
        if (!versionInfo.downloads.asar || !versionInfo.minInstallerVersion) { // check if version has a download
            return false;
        }

        if (new URL(versionInfo.downloads.asar).hostname.endsWith('.obsidian.md')) {
            const hasCreds = !!(process.env['OBSIDIAN_EMAIL'] && process.env['OBSIDIAN_PASSWORD']);
            const inCache = await this.isInCache('app', versionInfo.version);
            return (hasCreds || inCache);
        } else {
            return true;
        }
    }
}
