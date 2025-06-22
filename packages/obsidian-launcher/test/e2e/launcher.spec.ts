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
import { fileExists, atomicCreate } from "../../src/utils.js";
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

describe("ObsidianLauncher", function() {
    this.timeout(60 * 1000);
    const { platform, arch } = process;
    let launcher: ObsidianLauncher;
    const testData = path.resolve("../../.obsidian-cache/test-data");
    let server: http.Server|undefined;
    let latest = "";

    before(async function() {
        this.timeout(10 * 60 * 1000);
        launcher = new ObsidianLauncher(obsidianLauncherOpts);
        await fsAsync.mkdir(testData, {recursive: true});

        const versionInfo = await launcher.getVersionInfo("latest");
        latest = versionInfo.version;

        await downloadIfNotExists(versionInfo.downloads.asar!, testData);
        await downloadIfNotExists(launcher['getInstallerUrl'](versionInfo)!, testData);

        server = http.createServer((request, response) => {
            return serverHandler(request, response, {public: testData});
        });
        await new Promise<void>(resolve => server!.listen({port: 0}, resolve));
        const port = (server!.address() as AddressInfo).port;

        // Create constant version of obsidian-versions.json
        const tmpDir = await createDirectory({
            "obsidian-versions.json": JSON.stringify({
                metadata: {
                    "date": "2025-01-07T00:00:00Z",
                    "sha": "0000000",
                },
                versions: [{
                    ...versionInfo,
                    downloads: _.mapValues(versionInfo.downloads,
                        v => `http://localhost:${port}/${v!.split("/").at(-1)!}`
                    ),
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
        const path = await launcher.downloadInstaller(latest);
        expect(await fileExists(path)).to.eql(true);
    })

    it("test downloadApp", async function() {
        // test that it downloads and extracts properly
        const path = await launcher.downloadApp(latest);
        expect(await fileExists(path)).to.eql(true);
    })

    it("test launch", async function() {
        const {proc, configDir} = await launcher.launch({
            appVersion: latest, installerVersion: latest,
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
