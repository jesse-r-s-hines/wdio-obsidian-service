import { describe, it } from "mocha";
import { expect } from "chai";
import _ from "lodash";
import fsAsync from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import serverHandler from "serve-handler";
import http from "http";
import CDP from 'chrome-remote-interface'
import { createDirectory } from "../helpers.js";
import { ObsidianLauncher } from "../../src/launcher.js";
import { downloadResponse } from "../../src/apis.js";
import { fileExists, atomicCreate, sleep, withTimeout } from "../../src/utils.js";

const obsidianLauncherOpts = {
    versionsUrl: pathToFileURL("../../obsidian-versions.json").toString(),
    communityPluginsUrl: pathToFileURL("./test/data/community-plugins.json").toString(),
    communityThemesUrl: pathToFileURL("./test/data/community-css-themes.json").toString(),
}

async function downloadIfNotExists(url: string, dest: string) {
    if (!(await fileExists(dest))) {
        await atomicCreate(dest, async (tmpDir) => {
            await downloadResponse(await fetch(url), path.join(tmpDir, "out"));
            return path.join(tmpDir, "out");
        })
    }
}

describe("ObsidianLauncher", function() {
    this.timeout(60 * 1000);
    const { platform, arch } = process;
    let launcher: ObsidianLauncher;
    const testData = path.resolve("../../.obsidian-cache/test-data");
    let server: http.Server|undefined;

    before(async function() {
        this.timeout(10 * 60 * 1000);
        launcher = new ObsidianLauncher(obsidianLauncherOpts);
        await fsAsync.mkdir(testData, {recursive: true});

        const versionInfo = await launcher.getVersionInfo("latest");
        await downloadIfNotExists(versionInfo.downloads.asar!, path.join(testData, `obsidian.asar.gz`));
        const installerUrl = launcher['getInstallerUrl'](versionInfo)!;
        await downloadIfNotExists(installerUrl, path.join(testData, `obsidian-${platform}-${arch}`));
        server = http.createServer((request, response) => {
            return serverHandler(request, response, {public: testData});
        });
        server.listen(8080);

        // Create constant version of obsidian-versions.json
        const tmpDir = await createDirectory({
            "obsidian-versions.json": JSON.stringify({
                metadata: {
                    "date": "2025-01-07T00:00:00Z",
                    "sha": "0000000",
                },
                versions: [{
                    version: "1.8.10",
                    minInstallerVersion: "1.8.10",
                    maxInstallerVersion: "1.8.10",
                    isBeta: false,
                    gitHubRelease: "https://github.com/obsidianmd/obsidian-releases/releases/tag/v1.8.10",
                    downloads: {
                        asar: `http://localhost:8080/obsidian.asar.gz`,
                        appImage: `http://localhost:8080/obsidian-${platform}-${arch}`,
                        appImageArm: `http://localhost:8080/obsidian-${platform}-${arch}`,
                        apk: `http://localhost:8080/obsidian-${platform}-${arch}`,
                        dmg: `http://localhost:8080/obsidian-${platform}-${arch}`,
                        exe: `http://localhost:8080/obsidian-${platform}-${arch}`,
                    },
                    electronVersion: "34.2.0",
                    chromeVersion: "132.0.6834.196",
                    nodeVersion: "20.18.2",
                }],
            }),
        });
        const cacheDir = await createDirectory();

        launcher = new ObsidianLauncher({
            ...obsidianLauncherOpts,
            cacheDir: cacheDir,
            versionsUrl: pathToFileURL(`${tmpDir}/obsidian-versions.json`).toString(),
        });
    })

    after(async function() {
        server?.closeAllConnections();
        server?.close();
    })

    it("test downloadInstaller", async function() {
        // test that it downloads and extracts properly
        const path = await launcher.downloadInstaller("1.8.10");
        expect(await fileExists(path)).to.eql(true);
    })

    it("test downloadApp", async function() {
        // test that it downloads and extracts properly
        const path = await launcher.downloadApp("1.8.10");
        expect(await fileExists(path)).to.eql(true);
    })

    it("test launch", async function() {
        const {proc, configDir} = await launcher.launch({
            appVersion: "1.8.10",
            installerVersion: "1.8.10",
            args: ["--remote-debugging-port=0"],
        });
        const procExit = new Promise<number>((resolve) => proc.on('exit', (code) => resolve(code ?? -1)));
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
        expect(response.result.value).to.eql("34.2.0");
        await client.close();
        proc.kill("SIGTERM");
        await procExit;
        await fsAsync.rm(configDir, { recursive: true, force: true });
    })
})
