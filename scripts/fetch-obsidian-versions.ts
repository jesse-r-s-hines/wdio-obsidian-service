/**
 * Script that collects information for all Obsidian versions in a single file. The file can then be used to easily
 * lookup download URLs for a given Obsidian version, and check Obsidian to Electron/Chrome version mappings.
 */

import * as fsAsync from "fs/promises"
import * as path from "path"
import * as os from "os"
import CDP from 'chrome-remote-interface'
import * as child_process from "child_process"
import _ from "lodash"
import { compareVersions, sleep, withTimeout, pool } from "../src/utils.js";
import { fetchGitHubAPIPaginated } from "../src/apis.js";
import { ObsidianVersionInfo, ObsidianVersionInfos } from "../src/types.js"


/** Get basic version info */
function getVersionInfo(fileRelease: any, githubRelease: any, isBeta: boolean): ObsidianVersionInfo {
    const version = fileRelease.latestVersion;

    let result: ObsidianVersionInfo = {
        version: version,
        minInstallerVersion: fileRelease.minimumVersion,
        maxInstallerVersion: "", // We'll set this later
        isBeta: isBeta,
        downloads: {},
    }

    if (githubRelease) {
        const assets: string[] = githubRelease.assets.map((a: any) => a.browser_download_url);
        result.githubRelease = githubRelease.html_url;
        result.downloads = {
            appImage: assets.find(u => u.match(`${version}.AppImage$`)),
            appImageArm: assets.find(u => u.match(`${version}-arm64.AppImage$`)),
            apk: assets.find(u => u.match(`${version}.apk$`)),
            asar: assets.find(u => u.match(`${version}.asar.gz$`)),
            dmg: assets.find(u => u.match(`${version}(-universal)?.dmg$`)),
            exe: assets.find(u => u.match(`${version}.exe$`)),
        };
    } else {
        result.downloads = {
            asar: fileRelease.downloadUrl,
        };
    }

    return result;
}


async function extractDependencyVersionInfo(appImageUrl: string): Promise<Record<string, string>> {
    const tmpDir = await fsAsync.mkdtemp(path.join(os.tmpdir(), `optl-fetch-versions-`));
    const appImage = path.join(tmpDir, appImageUrl.split("/").at(-1)!)
    console.log(`${appImage}: Extracting electron & chrome versions...`)

    await fsAsync.writeFile(appImage, (await fetch(appImageUrl)).body as any);
    await fsAsync.chmod(appImage, 0o755);

    const proc = child_process.spawn(appImage, [
        `--remote-debugging-port=0`, // 0 will make it choose a random available port
        '--test-type=webdriver',
        `--user-data-dir=${tmpDir}`,
    ]);
    const procExit = new Promise<number>((resolve) => proc.on('exit', (code, signal) => resolve(code ?? -1)));

    // proc.stdout.on('data', data => { console.log(`stdout: ${data}`) });
    // proc.stderr.on('data', data => { console.log(`stderr: ${data}`) });

    let dependencyVersions: any;
    try {
        // Wait for the logs showing that Obsidian is ready, and pull the chosen DevTool Protocol port from it
        const port = await new Promise<number>((resolve, reject) => {
            const timer = setTimeout(() => reject('Starting obsidian timed out'), 10 * 1000);
            proc.stderr.on('data', data => {
                const port = data.toString().match(/ws:\/\/[\w\.]+?:(\d+)/)?.[1];
                if (port) {
                    clearTimeout(timer);
                    resolve(Number(port));
                }
            });
        })
        const client = await CDP({port: port});
        const response = await client.Runtime.evaluate({ expression: "JSON.stringify(process.versions)" });
        dependencyVersions = JSON.parse(response.result.value);
        await client.close();
    } finally {
        proc.kill("SIGTERM");
        if (!(await withTimeout(procExit, 4000))) {
            console.log(`${appImage}: Stuck process ${proc.pid}, using SIGKILL`);
            proc.kill("SIGKILL");
        }
        await procExit;
        await sleep(1000); // Need to wait a bit or sometimes the rm fails because something else is writing to it
        await fsAsync.rm(tmpDir, { recursive: true, force: true });
    }

    if (!dependencyVersions?.electron || !dependencyVersions?.chrome) {
        throw Error(`Failed to extract electron and chrome versions for ${appImage}`)
    }

    return dependencyVersions;
}


async function getAllObsidianVersionInfos(maxInstances: number, original?: ObsidianVersionInfos): Promise<ObsidianVersionInfos> {
    const repo = 'obsidianmd/obsidian-releases';

    let commitHistory = await fetchGitHubAPIPaginated(`repos/${repo}/commits`, { path: "desktop-releases.json" });
    commitHistory.reverse();
    if (original) {
        commitHistory = commitHistory.slice(commitHistory.findIndex(c => c.sha == original.latestSha) + 1);
    }

    const fileHistory = await pool(8, commitHistory, commit =>
        fetch(`https://raw.githubusercontent.com/${repo}/${commit.sha}/desktop-releases.json`).then(r => r.json())
    )

    const githubReleases = _.keyBy(
        await fetchGitHubAPIPaginated(`repos/${repo}/releases`, {}),
        r => r.name,
    );

    const versionInfoMap = _.keyBy(original?.versions ?? [], v => v.version);
    for (const {beta, ...current} of fileHistory) {
        if (beta) {
            beta.isBeta = true;
            if (!versionInfoMap[beta.latestVersion] || versionInfoMap[beta.latestVersion].isBeta) {
                versionInfoMap[beta.latestVersion] = {
                    ...versionInfoMap[beta.latestVersion],
                    ...getVersionInfo(beta, githubReleases[beta.latestVersion], true),
                }
            }
        }
        current.isBeta = false;
        versionInfoMap[current.latestVersion] = {
            ...versionInfoMap[current.latestVersion],
            ...getVersionInfo(current, githubReleases[current.latestVersion], false),
        }
    }

    const versionInfos = await pool(maxInstances,
        Object.values(versionInfoMap),
        async (versionInfo) => {
            if (versionInfo.downloads.appImage && (!versionInfo.electronVersion || !versionInfo.chromeVersion)) {
                const dependencyVersions = await extractDependencyVersionInfo(versionInfo.downloads.appImage);
                versionInfo = {
                    ...versionInfo,
                    electronVersion: dependencyVersions.electron,
                    chromeVersion: dependencyVersions.chrome,
                }
            }
            return versionInfo
        },
    )

    versionInfos.sort((a, b) => compareVersions(a.version, b.version));
    let maxInstallerVersion = "0.0.0"
    for (const versionInfo of versionInfos) {
        if (versionInfo.downloads.appImage) {
            maxInstallerVersion = versionInfo.version;
        }
        versionInfo.maxInstallerVersion = maxInstallerVersion;
    }

    return {
        latestSha: commitHistory.at(-1)?.sha ?? original?.latestSha,
        versions: versionInfos,
    }
}


const dest = process.argv[2];
if (!dest) {
    throw Error("No file specified.")
}

let versionInfos: ObsidianVersionInfos|undefined;
try {
    versionInfos = JSON.parse(await fsAsync.readFile(dest, "utf-8"))
} catch {
    versionInfos = undefined;
}
versionInfos = await getAllObsidianVersionInfos(8, versionInfos);
fsAsync.writeFile(dest, JSON.stringify(versionInfos, undefined, 4));
