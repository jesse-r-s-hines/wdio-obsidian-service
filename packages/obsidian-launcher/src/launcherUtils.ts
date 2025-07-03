import fsAsync from "fs/promises"
import fs from "fs"
import path from "path"
import child_process from "child_process"
import spawn from "cross-spawn"
import semver from "semver"
import _ from "lodash"
import { pipeline } from "stream/promises";
import zlib from "zlib"
import { atomicCreate, makeTmpDir, normalizeObject } from "./utils.js";
import { downloadResponse } from "./apis.js"
import { ObsidianInstallerInfo, ObsidianVersionInfo } from "./types.js";


export function normalizeGitHubRepo(repo: string) {
    return repo.match(/^(https?:\/\/)?(github.com\/)?(.*?)\/?$/)?.[3] ?? repo;
}

export async function extractGz(archive: string, dest: string) {
    await pipeline(fs.createReadStream(archive), zlib.createGunzip(), fs.createWriteStream(dest));
}

export async function crossExecFile(command: string, args: string[] = [], options?: child_process.SpawnOptions) {
    const proc = spawn(command, args, {stdio: "pipe", ...options});
    let stdout = "", stderr = "";
    proc.stdout!.on('data', data => stdout += data);
    proc.stderr!.on('data', data => stderr += data);
    const procExit = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? -1)));
    const exitCode = await procExit;
    const result = {stdout, stderr}
    if (exitCode != 0) {
        throw Error(`"${command} ${args.join(' ')}" failed with ${exitCode}: ${JSON.stringify(result, undefined, 4)}`)
    }
    return result;
}

/**
 * Run 7zip.
 * Note there's some weirdness around absolute paths because of the way wasm's filesystem works. The root is mounted
 * under /nodefs, so either use relative paths or prefix paths with /nodefs.
 */
export async function sevenZ(args: string[], options?: child_process.SpawnOptions) {
    // package binaries are added to the path automatically
    return await crossExecFile("7z-wasm", args, options);
}

/**
 * Running AppImage requires libfuse2, extracting the AppImage first avoids that.
 */
export async function extractObsidianAppImage(appImage: string, dest: string) {
    // Could also use `--appimage-extract` instead.
    await atomicCreate(dest, async (tmpDir) => {
        await sevenZ(["x", "-o.", path.relative(tmpDir, appImage)], {cwd: tmpDir});
        return tmpDir;
    })
}


/**
 * Extract the obsidian.tar.gz
 */
export async function extractObsidianTar(tar: string, dest: string) {
    await atomicCreate(dest, async (tmpDir) => {
        await extractGz(tar, path.join(tmpDir, "inflated.tar"));
        await sevenZ(["x", "-o.", "inflated.tar"], {cwd: tmpDir});
        return (await fsAsync.readdir(tmpDir)).find(p => p.match("obsidian-"))!;
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
    await atomicCreate(dest, async (tmpDir) => {
        await sevenZ(["x", "-oinstaller", path.relative(tmpDir, exe), subArchive], {cwd: tmpDir});
        await sevenZ(["x", "-oobsidian", path.join("installer", subArchive)], {cwd: tmpDir});
        return "obsidian";
    })
}

/**
 * Extract the executable from the Obsidian dmg installer.
 */
export async function extractObsidianDmg(dmg: string, dest: string) {
    dest = path.resolve(dest);

    await atomicCreate(dest, async (tmpDir) => {
        // Current mac dmg files just have `Obsidian.app`, but on older '-universal' ones it's nested another level.
        await sevenZ(["x", "-o.", path.relative(tmpDir, dmg), "*/Obsidian.app", "Obsidian.app"], {cwd: tmpDir});
        const files = await fsAsync.readdir(tmpDir);
        if (files.includes("Obsidian.app")) {
            return "Obsidian.app"
        } else {
            return path.join(files[0], "Obsidian.app")
        }
    })
}


export function parseObsidianDesktopRelease(fileRelease: any, isBeta: boolean): Partial<ObsidianVersionInfo> {
    return {
        version: fileRelease.latestVersion,
        minInstallerVersion: fileRelease.minimumVersion != '0.0.0' ? fileRelease.minimumVersion : undefined,
        isBeta: isBeta,
        downloads: {
            asar: fileRelease.downloadUrl,
        },
    };
}

export function parseObsidianGithubRelease(gitHubRelease: any): Partial<ObsidianVersionInfo> {
    const version = gitHubRelease.name;
    const assets: string[] = gitHubRelease.assets.map((a: any) => a.browser_download_url);
    const downloads = {
        appImage: assets.find(u => u.match(`${version}.AppImage$`)),
        appImageArm: assets.find(u => u.match(`${version}-arm64.AppImage$`)),
        tar: assets.find(u => u.match(`${version}.tar.gz$`)),
        tarArm: assets.find(u => u.match(`${version}-arm64.tar.gz$`)),
        apk: assets.find(u => u.match(`${version}.apk$`)),
        asar: assets.find(u => u.match(`${version}.asar.gz$`)),
        dmg: assets.find(u => u.match(`${version}(-universal)?.dmg$`)),
        exe: assets.find(u => u.match(`${version}.exe$`)),
    }

    return {
        version: version,
        gitHubRelease: gitHubRelease.html_url,
        downloads: downloads,
    }
}

/**
 * Extract electron and chrome versions for an Obsidian version.
 * Takes path to the installer (the whole folder, not just the entrypoint executable).
 */
export async function getInstallerInfo(
    installerKey: keyof ObsidianVersionInfo['installerInfo'], url: string,
): Promise<ObsidianInstallerInfo> {
    const installerName = url.split("/").at(-1)!;
    console.log(`Extrating installer info for ${installerName}`)
    const tmpDir = await makeTmpDir("obsidian-launcher-");
    try {
        const installerPath = path.join(tmpDir, url.split("/").at(-1)!)
        await downloadResponse(await fetch(url), installerPath);
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
            const files = lines.map(l => l.split(/\s+/).at(-1)!.replace("\\", "/"));

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

        let matches: string[] = [];
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

        return { electron, chrome, platforms };
    } finally {
        await fsAsync.rm(tmpDir, { recursive: true, force: true });
    }
}


/**
 * Add some corrections to the Obsidian version data.
 */
export function correctObsidianVersionInfo(versionInfo: Partial<ObsidianVersionInfo>): Partial<ObsidianVersionInfo> {
    const corrections: Partial<ObsidianVersionInfo>[] = [
        // These version's downloads are missing or broken.
        {version: '0.12.16', downloads: { asar: undefined }},
        {version: '1.4.7', downloads: { asar: undefined }},
        {version: '1.4.8', downloads: { asar: undefined }},
        
        // The minInstallerVersion here is incorrect
        {version: "1.3.4", minInstallerVersion: "0.14.5"},
        {version: "1.3.3", minInstallerVersion: "0.14.5"},
        {version: "1.3.2", minInstallerVersion: "0.14.5"},
        {version: "1.3.1", minInstallerVersion: "0.14.5"},
        {version: "1.3.0", minInstallerVersion: "0.14.5"},
    ]

    const result = corrections.find(v => v.version == versionInfo.version) ?? {};
    // minInstallerVersion is incorrect, running Obsidian with installer older than 1.1.9 won't boot with errors like
    // `(node:11592) electron: Failed to load URL: app://obsidian.md/starter.html with error: ERR_BLOCKED_BY_CLIENT`
    if (semver.gte(versionInfo.version!, "1.5.3") && semver.lt(versionInfo.minInstallerVersion!, "1.1.9")) {
        result.minInstallerVersion = "1.1.9"
    }

    return result;
}

/**
 * Normalize order and remove undefined values.
 */
export function normalizeObsidianVersionInfo(versionInfo: Partial<ObsidianVersionInfo>): ObsidianVersionInfo {
    versionInfo = {
        ...versionInfo,
        // kept for backwards compatibility
        electronVersion: versionInfo.installerInfo?.appImage?.electron,
        chromeVersion: versionInfo.installerInfo?.appImage?.chrome,
    };
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
        installerInfo: {
            appImage: {electron: null, chrome: null, platforms: null},
            appImageArm: {electron: null, chrome: null, platforms: null},
            tar: {electron: null, chrome: null, platforms: null},
            tarArm: {electron: null, chrome: null, platforms: null},
            dmg: {electron: null, chrome: null, platforms: null},
            exe: {electron: null, chrome: null, platforms: null},
        },
        electronVersion: null,
        chromeVersion: null,
    };
    return normalizeObject(canonicalForm, versionInfo) as ObsidianVersionInfo;
}
