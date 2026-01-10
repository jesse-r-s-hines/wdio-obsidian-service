import fsAsync from "fs/promises"
import fs from "fs"
import path from "path"
import { promisify } from "util";
import child_process from "child_process"
import semver from "semver"
import _ from "lodash"
import { pipeline } from "stream/promises";
import zlib from "zlib"
import { fileURLToPath, pathToFileURL } from "url"
import { DeepPartial } from "ts-essentials";
import type { RestEndpointMethodTypes } from "@octokit/rest";
import { consola } from "consola";
import CDP from "chrome-remote-interface";
import { ObsidianLauncher } from "./launcher.js";
import {
    atomicCreate, makeTmpDir, normalizeObject, pool, maybe, withTimeout, until, retry, UntilOpts,
 } from "./utils.js";
import { downloadResponse, fetchGitHubAPIPaginated } from "./apis.js"
import {
    ObsidianInstallerInfo, ObsidianVersionInfo, obsidianVersionsSchemaVersion, ObsidianVersionList,
} from "./types.js";
import { ObsidianDesktopRelease } from "./obsidianTypes.js"
const execFile = promisify(child_process.execFile);


export function normalizeGitHubRepo(repo: string) {
    return repo.match(/^(https?:\/\/)?(github.com\/)?(.*?)\/?$/)?.[3] ?? repo;
}


//// Installer Extraction ////

export async function extractGz(archive: string, dest: string) {
    await pipeline(fs.createReadStream(archive), zlib.createGunzip(), fs.createWriteStream(dest));
}

/**
 * Run 7zip.
 * Note there's some weirdness around absolute paths because of the way wasm's filesystem works. The root is mounted
 * under /nodefs, so either use relative paths or prefix paths with /nodefs.
 */
export async function sevenZ(args: string[], options?: child_process.SpawnOptions) {
    // run 7z.js script as sub_process (so it doesn't block the main thread)
    const sevenZipScript = path.resolve(fileURLToPath(import.meta.url), '../7z.js');
    const proc = child_process.spawn(process.execPath, [sevenZipScript, ...args], {
        stdio: "pipe",
        ...options,
    });

    let stdout = "", stderr = "";
    proc.stdout!.on('data', data => stdout += data);
    proc.stderr!.on('data', data => stderr += data);
    const procExit = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? -1)));
    const exitCode = await procExit;

    const result = {stdout, stderr}
    if (exitCode != 0) {
        throw Error(`"7z ${args.join(' ')}" failed with ${exitCode}:\n${stdout}\n${stderr}`)
    }
    return result;
}

/**
 * Running AppImage requires libfuse2, extracting the AppImage first avoids that.
 */
export async function extractObsidianAppImage(appImage: string, dest: string) {
    // Could also use `--appimage-extract` instead.
    await atomicCreate(dest, async (scratch) => {
        await sevenZ(["x", "-o.", path.relative(scratch, appImage)], {cwd: scratch});
        return scratch;
    })
}


/**
 * Extract the obsidian.tar.gz
 */
export async function extractObsidianTar(tar: string, dest: string) {
    await atomicCreate(dest, async (scratch) => {
        await extractGz(tar, path.join(scratch, "inflated.tar"));
        await sevenZ(["x", "-o.", "inflated.tar"], {cwd: scratch});
        return (await fsAsync.readdir(scratch)).find(p => p.match("obsidian-"))!;
    })
}


/**
 * Obsidian appears to use NSIS to bundle their Window's installers. We want to extract the executable
 * files directly without running the installer. 7zip can extract the raw files from the exe.
 */
export async function extractObsidianExe(exe: string, arch: NodeJS.Architecture, dest: string) {
    // The installer contains several `.7z` files with files for different architectures
    let subArchive: string
    if (arch == "x64") {
        subArchive = `$PLUGINSDIR/app-64.7z`;
    } else if (arch == "ia32") {
        subArchive = `$PLUGINSDIR/app-32.7z`;
    } else if (arch == "arm64") {
        subArchive = `$PLUGINSDIR/app-arm64.7z`;
    } else {
        throw Error(`No Obsidian installer found for ${process.platform} ${process.arch}`);
    }
    await atomicCreate(dest, async (scratch) => {
        await sevenZ(["x", "-oinstaller", path.relative(scratch, exe), subArchive], {cwd: scratch});
        await sevenZ(["x", "-oobsidian", path.join("installer", subArchive)], {cwd: scratch});
        return "obsidian";
    })
}

/**
 * Extract the executable from the Obsidian dmg installer.
 */
export async function extractObsidianDmg(dmg: string, dest: string) {
    dest = path.resolve(dest);

    await atomicCreate(dest, async (scratch) => {
        if (process.platform == "darwin") {
            const proc = await execFile('hdiutil', ['attach', '-nobrowse', '-readonly', dmg]);
            const volume = proc.stdout.match(/\/Volumes\/.*$/m)![0];
            // Current mac dmg files just have `Obsidian.app`, but on older '-universal' ones it's nested another level.
            const files = await fsAsync.readdir(volume);
            let obsidianApp = files.includes("Obsidian.app") ? "Obsidian.app" : path.join(files[0], "Obsidian.app");
            obsidianApp = path.join(volume, obsidianApp);
            try {
                await fsAsync.cp(obsidianApp, scratch, {recursive: true, verbatimSymlinks: true, preserveTimestamps: true});
            } finally {
                await execFile('hdiutil', ['detach', volume]);
            }
            // Clear the `com.apple.quarantine` bit to avoid MacOS bocking the downloaded Obsidian executable "Obsidian
            // is damaged and can't be opened. This file was downloaded on an unknown date". See issue #46 and https://ss64.com/mac/xattr.html
            await execFile('xattr', ['-cr', scratch]);
            return scratch;
        } else {
            // we'll use 7zip if you aren't on MacOS so that we can still extract the executable on other platforms
            // (needed for the update-obsidian-versions GitHub workflow)
            await sevenZ(["x", "-o.", path.relative(scratch, dmg), "*/Obsidian.app", "Obsidian.app"], {cwd: scratch});
            const files = await fsAsync.readdir(scratch);
            const obsidianApp = files.includes("Obsidian.app") ? "Obsidian.app" : path.join(files[0], "Obsidian.app");
            return path.join(scratch, obsidianApp);
        }
    });
}


//// CDP ////

/**
 * Launches Obsidian. Returnsa CDP client connected to it and a function to cleanup the process and resources.
 * Mostly used for testing, but also used in updateVersionList.
 * 
 * This logic is somewhat duplicated with wdio-obsidian-service's setup, but I don't want obsidian-launcher to depend
 * on wdio or wdio-obsidian-service.
 */
export async function getCdpSession(
    launcher: ObsidianLauncher, appVersion: string, installerVersion: string,
) {
    [appVersion, installerVersion] = await launcher.resolveVersion(appVersion, installerVersion);

    const cleanup: (() => Promise<void>)[] = [];
    const doCleanup = async () => {
        for (const func of [...cleanup].reverse()) {
            await func()
        }
    }

    const vault = await makeTmpDir("obsidian-vault-");
    cleanup.push(() => fsAsync.rm(vault, {recursive: true, force: true}));
    const pluginDir = path.join(vault, ".obsidian", "plugins", "obsidian-launcher");
    await fsAsync.mkdir(pluginDir, {recursive: true});
    await fsAsync.writeFile(path.join(pluginDir, "manifest.json"), JSON.stringify({
        id: "obsidian-launcher", name: "Obsidian Launcher",
        version: "1.0.0", minAppVersion: "0.0.1",
        description: "", author: "obsidian-launcher", isDesktopOnly: false
    }));
    await fsAsync.writeFile(path.join(pluginDir, "main.js"), `
        const obsidian = require('obsidian');
        class ObsidianLauncherPlugin extends obsidian.Plugin {
            async onload() { window.obsidianLauncher = {app: this.app, obsidian: obsidian}; };
        }
        module.exports = ObsidianLauncherPlugin;
    `);
    await fsAsync.writeFile(path.join(vault, ".obsidian", "community-plugins.json"), JSON.stringify([
        "obsidian-launcher",
    ]));

    try {
        const {proc, configDir} = await launcher.launch({
            appVersion, installerVersion, vault, copy: false,
            args: [`--remote-debugging-port=0`, '--test-type=webdriver'], // will choose a random available port
        });
        cleanup.push(() => fsAsync.rm(configDir, {recursive: true, force: true}));
        const procExit = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? -1)));
        cleanup.push(async () => {
            proc.kill("SIGTERM");
            const timeout = await maybe(withTimeout(procExit, 5 * 1000));
            if (!timeout.success) {
                consola.warn(`Stuck process ${proc.pid}, using SIGKILL`);
                proc.kill("SIGKILL");
            }
            await procExit;
        });

        // Wait for the logs showing that Obsidian is ready, and pull the chosen DevTool Protocol port from it
        const portPromise = new Promise<number>((resolve, reject) => {
            void procExit.then(() => reject(Error("Processed ended without opening a port")));
            proc.stderr!.on('data', data => {
                const port = data.toString().match(/ws:\/\/[\w.]+?:(\d+)/)?.[1];
                if (port) {
                    resolve(Number(port));
                }
            });
        });
        const port = await maybe(withTimeout(portPromise, 20 * 1000));
        if (!port.success) {
            throw new Error("Timed out waiting for Chrome DevTools protocol port");
        }

        const client = await CDP({port: port.result});
        cleanup.push(() => client.close());

        const expr = semver.gte(appVersion, '0.12.8') ? "!!window.obsidianLauncher" : "!!window.app.workspace";
        await until(
            () => client.Runtime.evaluate({expression: expr}).then(r => r.result.value),
            {timeout: 5000},
        );

        return {
            client,
            cleanup: doCleanup,
            proc,
        };
    } catch (e: any) {
        await doCleanup();
        throw e;
    }
}

export async function cdpEvaluate(client: CDP.Client, expression: string) {
    const response = await client.Runtime.evaluate({ expression, returnByValue: true });
    if (response.exceptionDetails) {
        throw Error(response.exceptionDetails.text);
    }
    return response.result.value;
}

export async function cdpEvaluateUntil(client: CDP.Client, expression: string, opts: UntilOpts) {
    return await until(() => cdpEvaluate(client, expression), opts);
}

//// updateVersionList helpers ////

export type CommitInfo = {commitDate: string, commitSha: string}
/**
 * Fetch all versions of obsidianmd/obsidian-releases desktop-releases.json since sinceDate and sinceSha
 */
export async function fetchObsidianDesktopReleases(
    sinceDate?: string, sinceSha?: string,
): Promise<[ObsidianDesktopRelease[], CommitInfo]> {
    // Extract info from desktop-releases.json
    const repo = "obsidianmd/obsidian-releases";
    let commitHistory = await fetchGitHubAPIPaginated(`repos/${repo}/commits`, {
        path: "desktop-releases.json",
        since: sinceDate,
    });
    commitHistory.reverse(); // sort oldest first
    if (sinceSha) {
        commitHistory = _.takeRightWhile(commitHistory, c => c.sha != sinceSha);
    }
    const fileHistory = await pool(4, commitHistory, commit =>
        fetch(`https://raw.githubusercontent.com/${repo}/${commit.sha}/desktop-releases.json`).then(r => r.json())
    );
 
    const commitDate = commitHistory.at(-1)?.commit.committer.date ?? sinceDate;
    const commitSha = commitHistory.at(-1)?.sha ?? sinceSha;

    return [fileHistory, {commitDate, commitSha}]
}

/**
 * Subset of fields from the GitHub releases api.
 * I'm just using a subset instead of the full type from octokit so I can create tests without having to fill out all
 * the irrelevant fields.
 */
export type GitHubRelease = {
    id: number, html_url: string,
    tag_name: string, name: string|null,
    draft: boolean, prerelease: boolean,
    body?: string|null,
    assets: {
        id: number, name: string, digest?: string|null,
        browser_download_url: string,
    }[],
}
/** Fetches all GitHub release information from obsidianmd/obsidian-releases */
export async function fetchObsidianGitHubReleases(): Promise<GitHubRelease[]> {
    // verify that the full GitHub type is assignable to GitHubRelease
    type FullGitHubRelease = RestEndpointMethodTypes["repos"]["listReleases"]['response']['data'][number];
    const releases: FullGitHubRelease[] = await fetchGitHubAPIPaginated(`repos/obsidianmd/obsidian-releases/releases`);
    return releases.reverse(); // sort oldest first
}

const BROKEN_VERSIONS = [
    "0.12.16", // broken download link
    "1.4.7", // broken download link
    "1.4.8", // broken download link
    "1.0.1",  // won't launch
];

export type ParsedDesktopRelease = {current: DeepPartial<ObsidianVersionInfo>, beta?: DeepPartial<ObsidianVersionInfo>}
export function parseObsidianDesktopRelease(fileRelease: ObsidianDesktopRelease): ParsedDesktopRelease {
    const parse = (r: ObsidianDesktopRelease, isBeta: boolean): DeepPartial<ObsidianVersionInfo> => {
        return {
            version: r.latestVersion,
            isBeta: isBeta,
            downloads: {
                asar: r.downloadUrl,
            },
        };
    };

    const result: ParsedDesktopRelease = { current: parse(fileRelease, false) };
    if (fileRelease.beta && fileRelease.beta.latestVersion !== fileRelease.latestVersion) {
        result.beta = parse(fileRelease.beta, true);
    }
    return result;
}

export function parseObsidianGithubRelease(gitHubRelease: GitHubRelease): DeepPartial<ObsidianVersionInfo> {
    const version = gitHubRelease.name!;
    const assets: {url: string, digest: string}[] = gitHubRelease.assets.map((a: any) => ({
        url: a.browser_download_url,
        digest: a.digest ?? `id:${a.id}`,
    }));

    const asar = assets.find(a => a.url.match(`${version}.asar.gz$`));
    const appImage = assets.find(a => a.url.match(`${version}.AppImage$`));
    const appImageArm = assets.find(a => a.url.match(`${version}-arm64.AppImage$`));
    const tar = assets.find(a => a.url.match(`${version}.tar.gz$`));
    const tarArm = assets.find(a => a.url.match(`${version}-arm64.tar.gz$`));
    const dmg = assets.find(a => a.url.match(`${version}(-universal)?.dmg$`));
    const exe = assets.find(a => a.url.match(`${version}.exe$`));
    const apk = assets.find(a => a.url.match(`${version}.apk$`));

    return {
        version: version,
        gitHubRelease: gitHubRelease.html_url,
        downloads: {
            asar: asar?.url,
            appImage: appImage?.url,
            appImageArm: appImageArm?.url,
            tar: tar?.url,
            tarArm: tarArm?.url,
            dmg: dmg?.url,
            exe: exe?.url,
            apk: apk?.url,
        },
        installers: {
            appImage: appImage ? {digest: appImage.digest} : undefined,
            appImageArm: appImageArm ? {digest: appImageArm.digest} : undefined,
            tar: tar ? {digest: tar.digest} : undefined,
            tarArm: tarArm ? {digest: tarArm.digest} : undefined,
            dmg: dmg ? {digest: dmg.digest} : undefined,
            exe: exe ? {digest: exe.digest} : undefined,
        },
    }
}

export type InstallerKey = keyof ObsidianVersionInfo['installers'];
export const INSTALLER_KEYS: InstallerKey[] = [
    "appImage", "appImageArm", "tar", "tarArm", "dmg", "exe",
];

/**
 * Extract Electron and Chrome versions for an Obsidian version.
 * Takes path to the installer (the whole folder, not just the entrypoint executable).
 */
export async function extractInstallerInfo(
    version: string, installerKey: InstallerKey, url: string,
): Promise<Omit<ObsidianInstallerInfo, "digest">> {
    const installerName = url.split("/").at(-1)!;
    consola.log(`Extrating installer info for ${installerName}...`)
    const tmpDir = await makeTmpDir("obsidian-launcher-");
    try {
        const installerPath = path.join(tmpDir, url.split("/").at(-1)!)
        await downloadResponse(() => fetch(url), installerPath);
        const exractedPath = path.join(tmpDir, "Obsidian");
        let platforms: string[] = [];

        if (installerKey == "appImage" || installerKey == "appImageArm") {
            await extractObsidianAppImage(installerPath, exractedPath);
            platforms = ['linux-' + (installerKey == "appImage" ? 'x64' : 'arm64')];
        } else if (installerKey == "tar" || installerKey == "tarArm") {
            await extractObsidianTar(installerPath, exractedPath);
            platforms = ['linux-' + (installerKey == "tar" ? 'x64' : 'arm64')];
        } else if (installerKey == "exe") {
            await extractObsidianExe(installerPath, "x64", exractedPath);
            const {stdout} = await sevenZ(["l", '-ba', path.relative(tmpDir, installerPath)], {cwd: tmpDir});
            const lines = stdout.trim().split("\n").map(l => l.trim());
            const files = lines.map(l => l.split(/\s+/).at(-1)!.replace(/\\/g, "/"));

            if (files.includes('$PLUGINSDIR/app-arm64.7z')) platforms.push("win32-arm64");
            if (files.includes('$PLUGINSDIR/app-32.7z')) platforms.push("win32-ia32");
            if (files.includes('$PLUGINSDIR/app-64.7z')) platforms.push("win32-x64");
        } else if (installerKey == "dmg") {
            await extractObsidianDmg(installerPath, exractedPath);
            platforms = ['darwin-arm64', 'darwin-x64'];
        } else {
            throw new Error(`Unknown installer key ${installerKey}`)
        }

        // This is horrific but works...
        // We grep the binary for the electron and chrome version strings. The proper way to do this would be to spin up
        // Obsidian and use CDP protocol to extract `process.versions`. However, that requires running Obsidian, and we
        // want to get the versions for all platforms and architectures. So we'd either have to set up some kind of
        // GitHub job matrix to run this on all platform/arch combinations or we can just grep the binary.

        const matches: string[] = [];
        const installerFiles = await fsAsync.readdir(exractedPath, {recursive: true, withFileTypes: true});
        for (const file of installerFiles) {
            if (file.isFile() && !file.name.endsWith(".asar")) {
                const stream = fs.createReadStream(path.join(file.parentPath, file.name), {encoding: "utf-8"});
                let prev = "";
                for await (let chunk of stream) {
                    const regex = /Chrome\/\d+\.\d+\.\d+\.\d+|Electron\/\d+\.\d+\.\d+/g;
                    chunk = prev + chunk; // include part of prev in case string gets split across chunks
                    matches.push(...[...(prev + chunk).matchAll(regex)].map(m => m[0]))
                    prev = chunk.slice(-64);
                }
            }
        }

        // get most recent versions
        const versionSortKey = (v: string) => v.split(".").map(s => s.padStart(9, '0')).join(".");
        const versions = _(matches)
            .map(m => m.split("/"))
            .groupBy(0)
            .mapValues(ms => ms.map(m => m[1]))
            .mapValues(ms => _.sortBy(ms, versionSortKey).at(-1)!)
            .value();
    
        const electron = versions['Electron'];
        const chrome = versions['Chrome'];

        if (!electron || !chrome) {
            throw new Error(`Failed to extract Electron and Chrome versions from binary ${installerPath}`);
        }

        consola.log(`Extracted installer info for ${installerName}`)
        return { electron, chrome, platforms };
    } finally {
        await fsAsync.rm(tmpDir, { recursive: true, force: true });
    }
}

/**
 * Checks if an Obsidian app and installer version are compatible.
 */
export async function checkCompatibility(
    launcher: ObsidianLauncher, appVersion: string, installerVersion: string,
) {
    [appVersion, installerVersion] = await launcher.resolveVersion(appVersion, installerVersion);
    consola.log(`Checking if app ${appVersion} and installer ${installerVersion} are compatible...`)
    // getCdpSession will download, but do it here first so we don't interpret network errors as launch failure
    await launcher.downloadApp(appVersion);
    await launcher.downloadInstaller(installerVersion);

    // retry cdp result on errors, but interpret consistent errors as an incompatibility
    const cdpResult = await maybe(retry(
        () => getCdpSession(launcher, appVersion, installerVersion),
        {retries: 3, backoff: 4000},
    ));
    if (!cdpResult.success) {
        consola.log(`app ${appVersion} with installer ${installerVersion} failed to launch: ${cdpResult.error}`);
        return false;
    }

    const { client, cleanup } = cdpResult.result;
    let result = true;
    try {
        if (semver.lt(appVersion, "0.7.4")) {
            // versions <0.7.4 show incompatibility warnings even for the installer of the same version. Something
            // must be broken with the installers listed in the release? Just setting these manually.
            result = semver.gte(installerVersion, '0.6.4');
        } else if (semver.lt(appVersion, "0.13.4")) {
            // the debug command was added in 0.13.4, so check the about page before then
            await cdpEvaluate(client, `window.app.commands.executeCommandById('app:open-settings')`);
            await until(() => cdpEvaluate(client, `
                document.evaluate(
                    "//*[contains(@class, 'vertical-tab-nav-item') and contains(text(),'About')]",
                    document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                ).singleNodeValue.click() ?? true;
            `), {timeout: 5000});
            const aboutText = await until(() => cdpEvaluate(client, `
                document.evaluate(
                    "//*[contains(@class, 'setting-item-name') and contains(text(),'Current version:')]",
                    document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
                ).singleNodeValue.parentNode.innerText;
            `), {timeout: 5000});
            if (['manual installation', "manually install"].some(t => aboutText.includes(t))) {
                result = false;
            }
        } else {
            // check the debug info for installer incompatibility warning
            await cdpEvaluate(client, `window.obsidianLauncher.app.commands.executeCommandById('app:show-debug-info')`);
            const debugInfo: string = await cdpEvaluateUntil(client,
                `document.querySelector(".debug-textarea").value.trim()`,
                {timeout: 5000},
            );
            if (debugInfo.toLowerCase().match(/installer version too low/)) {
                result = false;
            }
        }
    } finally {
        await cleanup();
    }

    consola.log(`app ${appVersion} and installer ${installerVersion} are ${!result ? 'in' : ''}compatible`);
    return result;
}

/** Get min and max installer for each version. */
export async function getCompatibilityInfos(
    versions: ObsidianVersionInfo[],
    {_checkCompatibility = checkCompatibility} = {},
): Promise<DeepPartial<ObsidianVersionInfo>[]> {
    const tmp = await makeTmpDir("obsidian-installer-compat-");
    try {
        // setup an obsidian-versions.json file with dummy minInstallerVersion values so we run ObsidianLauncher
        const versionsFile: ObsidianVersionList = {
            metadata: {
                schemaVersion: obsidianVersionsSchemaVersion,
                commitDate: "1970-01-01T00:00:00Z",
                commitSha: "0000000000000000000000000000000000000000",
                timestamp: "1970-01-01T00:00:00Z"
            },
            versions: versions.map(v => ({
                ...v,
                minInstallerVersion: v.minInstallerVersion ?? "0.0.0",
                maxInstallerVersion: v.maxInstallerVersion ?? "999.9.9",
            })),
        }
        await fsAsync.writeFile(path.join(tmp, 'obsidian-versions.json'), JSON.stringify(versionsFile));
        const launcher = new ObsidianLauncher({
            cacheDir: path.join(tmp, 'cache'),
            versionsUrl: pathToFileURL(path.join(tmp, 'obsidian-versions.json')).toString(),
        });

        const versionArr = _(_.cloneDeep(versions))
            .sort((a, b) => semver.compare(a.version, b.version))
            .dropWhile(v => !v.downloads.appImage) // drop versions before first installer
            .filter(v => !!v.downloads.asar) // drop versions without working asars
            .value();

        // populate maxInstallerVersion
        let maxInstallerVersion: string|undefined = undefined;
        for (const version of versionArr) {
            if (version.downloads.appImage) {
                maxInstallerVersion = version.version;
            }
            version.maxInstallerVersion = maxInstallerVersion;
        }

        // create array of only installer versions
        const installerArr = versionArr.filter(v => !!v.downloads.appImage);
        // map installer versions to their index
        const installerIndexMap = _.fromPairs(installerArr.map((v, i) => [v.version, i]));

        // populate minInstallerVersion
        for (const [i, version] of versionArr.entries()) {
            if (version.minInstallerVersion) {
                continue;
            }
            // do a binary search of sorts to find the first "compatible" installer
            const prev = i > 0 ? versionArr[i - 1] : undefined;
            let start = prev ? installerIndexMap[prev.minInstallerVersion!] : 0;
            let end = installerIndexMap[version.maxInstallerVersion!];

            while (start <= end) {
                const mid = Math.floor((start + end) / 2);
                const compatible = await _checkCompatibility(launcher,
                    version.version, installerArr[mid].version,
                );
                if (!compatible) {
                    start = mid + 1;
                } else {
                    end = mid - 1;
                }
            }
            if (start > installerIndexMap[version.maxInstallerVersion!]) {
                throw Error(`${version.version} failed to launch for all installers`)
            }
            version.minInstallerVersion = installerArr[start].version;
        }

        // Return only new information
        const origVersions = _(versions)
            .map(v => _.pick(v, ["version", "minInstallerVersion", "maxInstallerVersion"]))
            .keyBy(v => v.version)
            .value();
        return versionArr
            .map(v => ({
                version: v.version,
                minInstallerVersion: v.minInstallerVersion!, maxInstallerVersion: v.maxInstallerVersion!,
            }))
            .filter(v => !_.isEqual(v, origVersions[v.version]));
    } finally {
        await fsAsync.rm(tmp, {recursive: true, force: true});
    }
}

/**
 * Normalize order and remove undefined values.
 */
export function normalizeObsidianVersionInfo(versionInfo: DeepPartial<ObsidianVersionInfo>): ObsidianVersionInfo {
    versionInfo = _.cloneDeep(versionInfo);
    // kept for backwards compatibility
    versionInfo.electronVersion = versionInfo.installers?.appImage?.electron;
    versionInfo.chromeVersion = versionInfo.installers?.appImage?.chrome;
    // make sure downloads and installers exist even if empty
    versionInfo.downloads = versionInfo.downloads ?? {};
    versionInfo.installers = versionInfo.installers ?? {};

    // normalize order and removed undefined
    const canonicalForm = {
        version: null,
        minInstallerVersion: null,
        maxInstallerVersion: null,
        isBeta: null,
        gitHubRelease: null,
        downloads: {
            asar: null,
            appImage: null,
            appImageArm: null,
            tar: null,
            tarArm: null,
            dmg: null,
            exe: null,
            apk: null,
        },
        installers: {
            appImage: {digest: null, electron: null, chrome: null, platforms: null},
            appImageArm: {digest: null, electron: null, chrome: null, platforms: null},
            tar: {digest: null, electron: null, chrome: null, platforms: null},
            tarArm: {digest: null, electron: null, chrome: null, platforms: null},
            dmg: {digest: null, electron: null, chrome: null, platforms: null},
            exe: {digest: null, electron: null, chrome: null, platforms: null},
        },
        electronVersion: null,
        chromeVersion: null,
    };
    return normalizeObject(canonicalForm, versionInfo) as ObsidianVersionInfo;
}

/**
 * Updates obsidian version information.
 * @param maxInstances Number of parallel instances to use for the promise pool
 * @param opts Other options are for overriding internals in our tests
 */
export async function updateObsidianVersionList(original?: ObsidianVersionList, {
    maxInstances = 1,
    _fetchObsidianDesktopReleases = fetchObsidianDesktopReleases,
    _fetchObsidianGitHubReleases = fetchObsidianGitHubReleases,
    _extractInstallerInfo = extractInstallerInfo,
    _checkCompatibility = checkCompatibility,
} = {}): Promise<ObsidianVersionList> {
    const oldVersions = _.keyBy(original?.versions ?? [], v => v.version);
    let newVersions: _.Dictionary<DeepPartial<ObsidianVersionInfo>> = _.cloneDeep(oldVersions);

    const [destkopReleases, commitInfo] = await _fetchObsidianDesktopReleases(
        original?.metadata.commitDate, original?.metadata.commitSha,
    );
    for (const destkopRelease of destkopReleases) {
        const {current, beta} = parseObsidianDesktopRelease(destkopRelease);
        if (beta) {
            newVersions[beta.version!] = _.merge(newVersions[beta.version!] ?? {}, beta);
        }
        newVersions[current.version!] = _.merge(newVersions[current.version!] ?? {}, current);
    }

    const gitHubReleases = await _fetchObsidianGitHubReleases();
    for (const githubRelease of gitHubReleases) {
        // Skip some special "preleases"
        if (semver.valid(githubRelease.name) && !semver.prerelease(githubRelease.name!)) {
            const parsed = parseObsidianGithubRelease(githubRelease);
            const newVersion = _.merge(newVersions[parsed.version!] ?? {}, parsed);
            // remove out of date installerInfo (the installers can change for a version as happened with 1.8.10)
            for (const installerKey of INSTALLER_KEYS) {
                const oldDigest = oldVersions[parsed.version!]?.installers[installerKey]?.digest;
                const newDigest = newVersion.installers?.[installerKey]?.digest;
                if (oldDigest && oldDigest != newDigest) {
                    newVersion.installers![installerKey] = {digest: newDigest}; // wipe electron/chrome versions
                }
            }
            newVersions[parsed.version!] = newVersion;
        }
    }

    newVersions = _.omitBy(newVersions, v => BROKEN_VERSIONS.includes(v.version!));

    const newInstallers = Object.values(newVersions)
        .flatMap(v => INSTALLER_KEYS.map(k => [v, k] as const))
        .filter(([v, key]) => v.downloads?.[key] && !v.installers?.[key]?.chrome);
    const installerInfos = await pool(maxInstances, newInstallers, async ([v, key]) => {
        const installerInfo = await _extractInstallerInfo(v.version!, key, v.downloads![key]!);
        return {version: v.version, installers: {[key]: installerInfo}} as DeepPartial<ObsidianVersionInfo>;
    });
    for (const installerInfo of installerInfos) {
        newVersions[installerInfo.version!] = _.merge(newVersions[installerInfo.version!] ?? {}, installerInfo);
    }

    const compatInfos = await getCompatibilityInfos(
        Object.values(newVersions) as ObsidianVersionInfo[],
        {_checkCompatibility: _checkCompatibility},
    );
    for (const compatInfo of compatInfos) {
        newVersions[compatInfo.version!] = _.merge(newVersions[compatInfo.version!] ?? {}, compatInfo);
    }

    const result: ObsidianVersionList = {
        metadata: {
            schemaVersion: obsidianVersionsSchemaVersion,
            commitDate: commitInfo.commitDate,
            commitSha: commitInfo.commitSha,
            timestamp: original?.metadata.timestamp ?? "", // set down below
        },
        versions: Object.values(newVersions)
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
