import { describe, it } from "mocha";
import { expect } from "chai";
import _ from "lodash";
import os from "os";
import fsAsync from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import serverHandler from "serve-handler";
import http from "http";
import CDP from 'chrome-remote-interface'
import child_process from "child_process";
import { createDirectory } from "../helpers.js";
import { ObsidianLauncher } from "../../src/launcher.js";
import { downloadResponse, obsidianApiLogin } from "../../src/apis.js";
import { fileExists, atomicCreate, sleep, maybe } from "../../src/utils.js";
import { AddressInfo } from "net";

const obsidianLauncherOpts = {
    versionsUrl: pathToFileURL("../../obsidian-versions.json").toString(),
    communityPluginsUrl: pathToFileURL("./test/data/community-plugins.json").toString(),
    communityThemesUrl: pathToFileURL("./test/data/community-css-themes.json").toString(),
}

async function downloadIfNotExists(url: string, dest: string) {
    const name = url.split("/").at(-1)!;
    dest = path.join(dest, name);
    if (!(await fileExists(dest))) {
        await atomicCreate(dest, async (tmpDir) => {
            await downloadResponse(await fetch(url), path.join(tmpDir, "out"));
            return path.join(tmpDir, "out");
        })
    }
}

async function testLaunch(proc: child_process.ChildProcess) {
    const procExit = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? -1)));
    // proc.stdout!.on('data', data => console.log(`obsidian: ${data}`));
    // proc.stderr!.on('data', data => console.log(`obsidian: ${data}`));
    const port = await new Promise<number>((resolve, reject) => {
        void procExit.then(() => reject(Error("Processed ended without opening a port")))
        proc.stderr!.on('data', data => {
            const port = data.toString().match(/ws:\/\/[\w.]+?:(\d+)/)?.[1];
            if (port) {
                resolve(Number(port));
            }
        });
    })
    const client = await CDP({port: port});
    const response = await client.Runtime.evaluate({ expression: "process.versions.electron" });
    expect(response.result.value).to.match(/\d\.\d.\d/);
    await client.close();
    proc.kill("SIGTERM");
    await procExit;
    // Need to wait a bit or sometimes the rm fails because something else is writing to it
    await sleep(2000);
}

describe("ObsidianLauncher", function() {
    this.timeout(60 * 1000);
    let launcher: ObsidianLauncher;
    const testData = path.resolve("../../.obsidian-cache/test-data");
    let server: http.Server|undefined;
    let latest = "";
    const earliestApp = (process.platform == "win32" && process.arch == "arm64") ? "1.6.5" : "1.0.3";
    let earliestInstaller = "";

    before(async function() {
        this.timeout(10 * 60 * 1000);
        const cacheDir = await fsAsync.mkdtemp(path.join(os.tmpdir(), "mocha-"));
        launcher = new ObsidianLauncher({...obsidianLauncherOpts, cacheDir});
        await fsAsync.mkdir(testData, {recursive: true});

        const earliestAppVersionInfo = await launcher.getVersionInfo(earliestApp);
        earliestInstaller = (await launcher.resolveVersion(earliestApp, "earliest"))[1];
        const earliestInstallerVersionInfo = await launcher.getVersionInfo(earliestInstaller);
        const latestVersionInfo = await launcher.getVersionInfo("latest");
        latest = latestVersionInfo.version;
        const {platform, arch} = process;

        await downloadIfNotExists(earliestAppVersionInfo.downloads.asar!, testData);
        await downloadIfNotExists((await launcher.getInstallerInfo(earliestInstaller, {platform, arch})).url, testData);

        await downloadIfNotExists(latestVersionInfo.downloads.asar!, testData);
        await downloadIfNotExists((await launcher.getInstallerInfo(latest, {platform, arch})).url, testData);

        server = http.createServer((request, response) => {
            return serverHandler(request, response, {public: testData});
        });
        await new Promise<void>(resolve => server!.listen({port: 0}, resolve));
        const port = (server.address() as AddressInfo).port;

        // Create constant version of obsidian-versions.json
        const tmpDir = await createDirectory({
            "obsidian-versions.json": JSON.stringify({
                metadata: {
                    schemaVersion: '2.0.0',
                    commitDate: "2025-01-07T00:00:00Z",
                    commitSha: "0000000",
                },
                versions: [earliestInstallerVersionInfo, earliestAppVersionInfo, latestVersionInfo].map(v => ({
                    ...v,
                    downloads: _.mapValues(v.downloads,
                        v => `http://localhost:${port}/${v!.split("/").at(-1)!}`
                    ),
                })),
            }),
        });

        launcher = new ObsidianLauncher({
            ...obsidianLauncherOpts,
            cacheDir: cacheDir,
            versionsUrl: pathToFileURL(`${tmpDir}/obsidian-versions.json`).toString(),
        });
    })

    after(async function() {
        server?.closeAllConnections();
        server?.close();
        // on Windows something is holding on to files in the installer that causes the rm to be unreliable
        let success = false, retries = 0;
        while (!success && retries < 8) {
            success = (await maybe(fsAsync.rm(launcher.cacheDir, {force: true, recursive: true}))).success;
            retries++;
        }
    })

    it("test downloadApp", async function() {
        // test that it downloads and extracts properly
        const path = await launcher.downloadApp(latest);
        expect(await fileExists(path)).to.eql(true);
    })

    it("test downloadInstaller earliest", async function() {
        // test that it downloads and extracts properly
        const path = await launcher.downloadInstaller(earliestInstaller);
        expect(await fileExists(path)).to.eql(true);
    })

    it("test downloadInstaller latest", async function() {
        // test that it downloads and extracts properly
        const path = await launcher.downloadInstaller(latest);
        expect(await fileExists(path)).to.eql(true);
    })

    it("test launch earliest", async function() {
        const {proc, configDir} = await launcher.launch({
            appVersion: earliestApp, installerVersion: earliestInstaller,
            args: ["--remote-debugging-port=0"],
        });
        await testLaunch(proc);
        await fsAsync.rm(configDir, { recursive: true, force: true });
    })

    it("test launch latest", async function() {
        const {proc, configDir} = await launcher.launch({
            appVersion: latest, installerVersion: latest,
            args: ["--remote-debugging-port=0"],
        });
        await testLaunch(proc);
        await fsAsync.rm(configDir, { recursive: true, force: true });
    })
})


// describe("ObsidianLauncher login", function() {
//     let launcher: ObsidianLauncher;
//     this.timeout("60s");

//     before(async function() {
//         const cacheDir = await createDirectory();
//         // create the launcher so it loads dotenv files
//         launcher = new ObsidianLauncher({...obsidianLauncherOpts, cacheDir});
//         // only run this test on the CI where we know we have a valid, non-2FA set of credentials
//         if (!process.env.CI) this.skip();
//     })

//     it("test login", async function() {
//         const token = await obsidianApiLogin({interactive: false});
//         expect(!!token).to.eql(true);
//     })

//     it("test login error", async function() {
//         const pwdBefore = process.env.OBSIDIAN_PASSWORD;
//         after(() => { process.env.OBSIDIAN_PASSWORD = pwdBefore });
//         process.env.OBSIDIAN_PASSWORD = "incorrect-password";
//         const result = await obsidianApiLogin({interactive: false}).catch(e => e);
//         expect(result).to.be.instanceOf(Error);
//         expect(result.toString()).includes("login failed");
//     })
// })
