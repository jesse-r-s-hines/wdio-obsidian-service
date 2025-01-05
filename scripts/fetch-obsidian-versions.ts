
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


function parseFileRelease(fileRelease: any, isBeta: boolean): Partial<ObsidianVersionInfo> {
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

function parseGithubRelease(gitHubRelease: any): Partial<ObsidianVersionInfo> {
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


async function getDependencyVersions(version: string, appImageUrl: string): Promise<Partial<ObsidianVersionInfo>> {
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
        const portPromise = new Promise<number>((resolve, reject) => {
            procExit.then(() => reject("Processed ended without opening a port"))
            proc.stderr.on('data', data => {
                const port = data.toString().match(/ws:\/\/[\w\.]+?:(\d+)/)?.[1];
                if (port) {
                    resolve(Number(port));
                }
            });
        })
        if (!(await withTimeout(portPromise, 10 * 1000))) {
            throw new Error("Timed out waiting for Chrome DevTools protocol port");
        }
        const port = await portPromise;

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

    return {
        version: version,
        electronVersion: dependencyVersions.electron,
        chromeVersion: dependencyVersions.chrome,
    };
}


async function getAllObsidianVersionInfos(maxInstances: number, original?: ObsidianVersionInfos): Promise<ObsidianVersionInfos> {
    const repo = 'obsidianmd/obsidian-releases';

    let commitHistory = await fetchGitHubAPIPaginated(`repos/${repo}/commits`, {
        path: "desktop-releases.json",
        since: original?.latest.date,
    });
    commitHistory.reverse();
    if (original) {
        commitHistory = _.takeRightWhile(commitHistory, c => c.sha != original.latest.sha);
    }

    const fileHistory = await pool(8, commitHistory, commit =>
        fetch(`https://raw.githubusercontent.com/${repo}/${commit.sha}/desktop-releases.json`).then(r => r.json())
    );

    const githubReleases = await fetchGitHubAPIPaginated(`repos/${repo}/releases`);

    const versionMap: _.Dictionary<Partial<ObsidianVersionInfo>> = _.keyBy(original?.versions ?? [], v => v.version);

    for (const {beta, ...current} of fileHistory) {
        if (beta && (!versionMap[beta.latestVersion] || versionMap[beta.latestVersion].isBeta)) {
            versionMap[beta.latestVersion] = _.merge({}, versionMap[beta.latestVersion],
                parseFileRelease(beta, true),
            );
        }
        versionMap[current.latestVersion] = _.merge({}, versionMap[current.latestVersion],
            parseFileRelease(current, false),
        )
    }

    for (const release of githubReleases) {
        if (versionMap.hasOwnProperty(release.name)) {
            versionMap[release.name] = _.merge({}, versionMap[release.name], parseGithubRelease(release));
        }
    }

    const dependencyVersions = await pool(maxInstances,
        Object.values(versionMap).filter(v => v.downloads?.appImage && !v.chromeVersion),
        (v) => getDependencyVersions(v.version!, v.downloads!.appImage!),
    )
    for (const deps of dependencyVersions) {
        versionMap[deps.version!] = _.merge({}, versionMap[deps.version!], deps);
    }

    let maxInstallerVersion = "0.0.0"
    for (const version of Object.keys(versionMap).sort(compareVersions)) {
        if (versionMap[version].downloads!.appImage) {
            maxInstallerVersion = version;
        }
        versionMap[version].maxInstallerVersion = maxInstallerVersion;
    }

    const versionInfos = Object.values(versionMap) as ObsidianVersionInfo[];
    versionInfos.sort((a, b) => compareVersions(a.version, b.version));

    return {
        latest: {
            date: commitHistory.at(-1)?.commit.committer.date ?? original?.latest.date,
            sha: commitHistory.at(-1)?.sha ?? original?.latest.sha,
        },
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
