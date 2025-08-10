import { describe, it } from "mocha";
import { expect } from "chai";
import _ from "lodash";
import os from "os";
import fsAsync from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import CDP from 'chrome-remote-interface'
import { ObsidianLauncher } from "../../src/launcher.js";
import { extractInstallerInfo } from "../../src/launcherUtils.js";
import { obsidianApiLogin } from "../../src/apis.js";
import { fileExists, maybe } from "../../src/utils.js";
import { ObsidianVersionList } from "../../src/types.js";
import { cachedDownload, createServer } from "../helpers.js";

const obsidianLauncherOpts = {
    cacheDir: path.resolve("../../.obsidian-cache"),
    versionsUrl: pathToFileURL("../../obsidian-versions.json").toString(),
    communityPluginsUrl: pathToFileURL("./test/data/community-plugins.json").toString(),
    communityThemesUrl: pathToFileURL("./test/data/community-css-themes.json").toString(),
}

describe("ObsidianLauncher", function() {
    this.timeout(60 * 1000);
    let launcher: ObsidianLauncher;
    const testData = path.resolve("../../.obsidian-cache/test-data");
    const obsidianVersionsPath = path.resolve("../../obsidian-versions.json");
    const earliestApp = (process.platform == "win32" && process.arch == "arm64") ? "1.6.5" : "1.0.3";
    let latest = "";
    let earliestInstaller = "";
    let latestInstaller = "";

    before(async function() {
        this.timeout(10 * 60 * 1000);
        launcher = new ObsidianLauncher(obsidianLauncherOpts);
        await fsAsync.mkdir(testData, {recursive: true});

        earliestInstaller = (await launcher.resolveVersion(earliestApp, "earliest"))[1];
        latestInstaller = (await launcher.resolveVersion("latest", "latest"))[1];
        latest = (await launcher.getVersionInfo("latest")).version;
        const {platform, arch} = process;

        const earliestInstallerFile = await cachedDownload(
            (await launcher.getInstallerInfo(earliestInstaller, {platform, arch})).url,
            testData,
        );
        const latestInstallerFile = await cachedDownload(
            (await launcher.getInstallerInfo(latest, {platform, arch})).url,
            testData,
        );
        const latestAppFile = await cachedDownload(
            (await launcher.getVersionInfo(latest)).downloads.asar!,
            testData,
        );
        const obsidianVersions: ObsidianVersionList = JSON.parse(await fsAsync.readFile(obsidianVersionsPath, 'utf-8'));

        const server = await createServer();
        await server.addEndpoints({
            [path.basename(earliestInstallerFile)]: {path: earliestInstallerFile},
            [path.basename(latestInstallerFile)]: {path: latestInstallerFile},
            [path.basename(latestAppFile)]: {path: latestAppFile},
            "obsidian-versions.json": {content: JSON.stringify({
                ...obsidianVersions,
                versions: obsidianVersions.versions.map(v => ({
                    ...v,
                    downloads: _.mapValues(v.downloads,
                        v => `${server.url}/${v!.split("/").at(-1)!}`
                    ),
                })),
            })},
        })

        launcher = new ObsidianLauncher({
            ...obsidianLauncherOpts,
            cacheDir: await fsAsync.mkdtemp(path.join(os.tmpdir(), "mocha-")), // fresh cacheDir
            versionsUrl: `${server.url}/obsidian-versions.json`,
        });
    })

    after(async function() {
        // on Windows something is holding on to files in the installer that causes the rm to be unreliable
        const success = (await maybe(fsAsync.rm(launcher.cacheDir, {force: true, recursive: true}))).success;
        if (!success) {
            console.warn(`Failed to delete ${launcher.cacheDir}`);
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

    it("test launch latest", async function() {
        const {proc, configDir} = await launcher.launch({
            appVersion: latest, installerVersion: latest,
            args: ["--remote-debugging-port=0"],
        });
        after(() => fsAsync.rm(configDir, { recursive: true, force: true }));
    
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
    })

    it("test extractInstallerInfo", async function() {
        if (process.env.TEST_LEVEL != "all") this.skip();
        const versionInfo = await launcher.getVersionInfo(latestInstaller);
        const key = launcher['getInstallerKey'](versionInfo)!;
        const result = await extractInstallerInfo(key, versionInfo.downloads[key]!);
        expect(result.electron).match(/^.*\..*\..*$/)
        expect(result.chrome).match(/^.*\..*\..*\..*$/)
    })
})


describe("ObsidianLauncher login", function() {
    this.timeout("120s");

    before(async function() {
        if (process.env.TEST_LEVEL != "all") this.skip();
    })

    it("test login", async function() {
        const token = await obsidianApiLogin({interactive: false});
        expect(!!token).to.eql(true);
    })

    it("test login error", async function() {
        const pwdBefore = process.env.OBSIDIAN_PASSWORD;
        after(() => { process.env.OBSIDIAN_PASSWORD = pwdBefore });
        process.env.OBSIDIAN_PASSWORD = "incorrect-password";
        const result = await obsidianApiLogin({interactive: false}).catch(e => e);
        expect(result).to.be.instanceOf(Error);
        expect(result.toString()).includes("login failed");
    })
})
