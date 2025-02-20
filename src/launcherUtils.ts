import fsAsync from "fs/promises"
import path from "path"
import { promisify } from "util";
import child_process from "child_process"
import which from "which"
import semver from "semver"
import { withTmpDir } from "./utils.js";
import { ObsidianVersionInfo } from "./types.js";
const execFile = promisify(child_process.execFile);


export function normalizeGitHubRepo(repo: string) {
    return repo.replace(/^(https?:\/\/)?(github.com\/)/, '')
}

/**
 * Running AppImage requires libfuse2, extracting the AppImage first avoids that.
 */
export async function extractObsidianAppImage(appImage: string, dest: string) {
    await withTmpDir(dest, async (tmpDir) => {
        await fsAsync.chmod(appImage, 0o755);
        await execFile(appImage, ["--appimage-extract"], {cwd: tmpDir});
        return path.join(tmpDir, 'squashfs-root');
    })
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
    // TODO: should use hdiutil to remove dependency on 7zip. See https://stackoverflow.com/questions/11679475
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


export function parseObsidianDesktopRelease(fileRelease: any, isBeta: boolean): Partial<ObsidianVersionInfo> {
    return {
        version: fileRelease.latestVersion,
        minInstallerVersion: fileRelease.minimumVersion,
        maxInstallerVersion: "", // Will be set later
        isBeta: isBeta,
        downloads: {
            asar: fileRelease.downloadUrl,
        },
    };
}

export function parseObsidianGithubRelease(gitHubRelease: any): Partial<ObsidianVersionInfo> {
    const version = gitHubRelease.name;
    const assets: string[] = gitHubRelease.assets.map((a: any) => a.browser_download_url);

    return {
        version: version,
        gitHubRelease: gitHubRelease.html_url,
        downloads: {
            appImage: assets.find(u => u.match(`${version}.AppImage$`)),
            appImageArm: assets.find(u => u.match(`${version}-arm64.AppImage$`)),
            apk: assets.find(u => u.match(`${version}.apk$`)),
            asar: assets.find(u => u.match(`${version}.asar.gz$`)),
            dmg: assets.find(u => u.match(`${version}(-universal)?.dmg$`)),
            exe: assets.find(u => u.match(`${version}.exe$`)),
        },
    }
}

/**
 * Add some corrections to the Obsidian version data.
 */
export function correctObsidianVersionInfo(versionInfo: Partial<ObsidianVersionInfo>): Partial<ObsidianVersionInfo> {
    const corrections: Partial<ObsidianVersionInfo> = {}
    // minInstallerVersion is incorrect, running Obsidian with installer older than 1.1.9 won't boot with errors like
    // `(node:11592) electron: Failed to load URL: app://obsidian.md/starter.html with error: ERR_BLOCKED_BY_CLIENT`
    if (semver.gte(versionInfo.version!, "1.5.3") && semver.lt(versionInfo.minInstallerVersion!, "1.1.9")) {
        corrections.minInstallerVersion = "1.1.9"
    }

    return corrections;
}
