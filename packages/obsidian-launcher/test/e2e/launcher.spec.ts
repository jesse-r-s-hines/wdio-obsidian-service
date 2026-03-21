import { describe, it } from "mocha";
import { expect } from "chai";
import _ from "lodash";
import os from "os";
import fsAsync from "fs/promises";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import semver from "semver"
import { ObsidianLauncher, minSupportedObsidianVersion } from "../../src/launcher.js";
import { extractInstallerInfo, getCdpSession, cdpEvaluate, checkCompatibility } from "../../src/launcherUtils.js";
import { obsidianApiLogin, fetchObsidianApi } from "../../src/apis.js";
import { fileExists, maybe } from "../../src/utils.js";
import { ObsidianVersionList } from "../../src/types.js";
import { createServer, createDirectory } from "../helpers.js";

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
    const versionInfos: ObsidianVersionList = JSON.parse(fs.readFileSync(obsidianVersionsPath, 'utf-8'));

    let versions = _(versionInfos.versions)
        // remove betas and unsupported
        .filter(v => !v.isBeta && !!v.minInstallerVersion && semver.gte(v.version, minSupportedObsidianVersion))
        // only versions with compatible installer on current platform
        .filter(v => _.values(v.installers).some(i => i.platforms.includes(`${process.platform}-${process.arch}`)))
        .map(v => v.version)
        .keyBy(v => v.split(".").slice(0, 2).join('.')) // key by minor version, keyBy keeps last
        .values()
        .map(v => [v, v] as const)
        .value();
    const latest = versions.at(-1)![0];
    const latestMinInstaller = versionInfos.versions.find(v => v.version == latest)!.minInstallerVersion!;
    const latestBeta = versionInfos.versions.at(-1)!.version;
    const latestInstaller = versionInfos.versions.at(-1)!.maxInstallerVersion!;
    if (process.env.TEST_LEVEL == "all") {
        versions = [ // sample a range of versions
            ..._.range(0, versions.length - 2, (versions.length - 2) / 3).map(i => versions[Math.trunc(i)]),
            ...versions.slice(-1),
            [latest, latestMinInstaller],
        ];
        if (latestBeta != latest) {
            versions.push([latestBeta, latestInstaller]);
        }
    } else {
        versions = [versions[0], ...versions.slice(-2), [latest, latestMinInstaller]]
    }

    before(async function() {
        this.timeout(10 * 60 * 1000);

        // mock server that caches requests to Obsidian assets
        const server = await createServer(testData, Object.fromEntries(versionInfos.versions
            .flatMap(v => Object.values(v.downloads))
            .map(url => [url.replace(/^https?:\/\//, ''), {async fetch() {
                if (new URL(url).hostname.endsWith('.obsidian.md')) {
                    return await fetchObsidianApi(url, {token: 'token'});
                } else {
                    return await fetch(url)
                }
            }}])
        ));
        await server.addEndpoints({
            'obsidian-versions.json': {content: JSON.stringify({
                ...versionInfos,
                versions: versionInfos.versions.map(v => ({
                    ...v,
                    downloads: _.mapValues(v.downloads, u => u ? `${server.url}/${u.replace(/^https?:\/\//, '')}` : u),
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

    it("test downloadInstaller latest", async function() {
        // test that it downloads and extracts properly
        const path = await launcher.downloadInstaller(latest);
        expect(await fileExists(path)).to.eql(true);
    })

    it("test downloadInstaller earliest", async function() {
        // test that it downloads and extracts properly
        const path = await launcher.downloadInstaller(versions[0][0]);
        expect(await fileExists(path)).to.eql(true);
    })

    it("test extractInstallerInfo", async function() {
        if (process.env.TEST_LEVEL != "all") this.skip();
        const versionInfo = await launcher.getVersionInfo(latest);
        const key = launcher['getInstallerKey'](versionInfo)!;
        const result = await extractInstallerInfo(latest, key, versionInfo.downloads[key]!);
        expect(result.electron).match(/^.*\..*\..*$/)
        expect(result.chrome).match(/^.*\..*\..*\..*$/)
    })

    it("test checkCompatibility compatible", async function() {
        if (process.env.TEST_LEVEL != "all") this.skip();
        expect(await checkCompatibility(launcher, latest, latestMinInstaller)).to.equal(true);
        expect(await checkCompatibility(launcher, ...versions[0])).to.equal(true);
    })

    it("test checkCompatibility incompatible", async function() {
        if (process.env.TEST_LEVEL != "all") this.skip();
        const installers = versions.map(v => v[1]).sort(semver.compare);
        const incompatibleInstaller = _.findLast(installers, v => semver.lt(v, latestMinInstaller))!;
        expect(await checkCompatibility(launcher, latest, incompatibleInstaller)).to.equal(false);
    })

    for (const [appVersion, installerVersion] of versions) {
        it(`test launch ${appVersion}/${installerVersion}`, async function() {
            const vault = path.join(await createDirectory({"my-vault/A.md": "A"}), 'my-vault');
            const {client, cleanup} = await getCdpSession(launcher, {appVersion, installerVersion, vault});
            try {
                const actualVault = await cdpEvaluate(client, "obsidianLauncher.app.vault.adapter.getFullPath('')");
                expect(actualVault).to.match(/my-vault/)

                const actualAppVersion = await cdpEvaluate(client, "require('electron').ipcRenderer.sendSync('version')");
                expect(actualAppVersion).to.eql(appVersion);

                const actualInstallerVersion = await cdpEvaluate(client, "require('electron').remote.app.getVersion()")
                expect(actualInstallerVersion).to.eql(installerVersion);
            } finally {
                await cleanup();
            }
        });
    }

    // These are broken as of Obsidian 1.12.5
    // const cliVersions = versions.filter(([appVersion, installerVersion]) =>
    //     semver.gte(appVersion, "1.12.0") && semver.gte(installerVersion, "1.11.7")
    // );
    // async function runObsidianCli(args: string[]) {
    //     return await execFile(...await launcher.getObsidianCli(args));
    // }
    // for (const [appVersion, installerVersion] of cliVersions) {
    //     describe(`Obsidian CLI ${appVersion}/${installerVersion}`, function() {
    //         let vaultA: string|undefined;
    //         let vaultB: string|undefined;
    //         let vaultBCopy: string|undefined;
    //         const cleanup: (() => Promise<void>)[] = []

    //         before(async function() {
    //             vaultA = path.join(await createDirectory({"notes-a/foo/A.md": "A"}), "notes-a");
    //             vaultB = path.join(await createDirectory({"notes-b/B.md": "B"}), 'notes-b');

    //             const launchResultA = await getCdpSession(launcher, {
    //                 appVersion, installerVersion,
    //                 vault: vaultA, copy: false,
    //             });
    //             cleanup.push(launchResultA.cleanup);

    //             const launchResultB = await getCdpSession(launcher, {
    //                 appVersion, installerVersion, vault: vaultB, copy: true,
    //             });
    //             cleanup.push(launchResultB.cleanup);
    //             vaultBCopy = launchResultB.vault;
    //         });

    //         after(async function() {
    //             for (const f of cleanup) {
    //                 await f();
    //             }
    //         });

    //         it('test no vault specified', async function() {
    //             const {stdout} = await runObsidianCli(['vault']);
    //             expect(stdout).to.match(/^path.*notes-b-.+$/m); // picks latest launched instance
    //         })

    //         it('select uncopied vault', async function () {
    //             const {stdout} = await runObsidianCli(['vault=notes-a', 'vault']);
    //             expect(stdout).to.match(/^path.*notes-a\s*$/m);
    //         })

    //         it('select copied vault by original name', async function () {
    //             const {stdout} = await runObsidianCli(['vault=notes-b', 'vault']);
    //             expect(stdout).to.match(/^path.*notes-b-.+$/m);
    //         })

    //         it('select copied vault by new name', async function () {
    //             const {stdout} = await runObsidianCli([`vault=${path.basename(vaultBCopy!)}`, 'vault']);
    //             expect(stdout).to.match(/^path.*notes-b-.+$/m);
    //         })

    //         it('select vault by id', async function () {
    //             let {stdout: vaultId} = await runObsidianCli(['vault=notes-a', 'eval', 'code=app.appId']);
    //             vaultId = vaultId.trim().replace(/^=>/, '').trim();

    //             const {stdout} = await runObsidianCli([`vault=${vaultId}`, 'vault']);
    //             expect(stdout).to.match(/^path.*notes-a\s*$/m);
    //         })

    //         it('select vault by cwd A', async function () {
    //             await withCwd(vaultA!, async () => {
    //                 const {stdout} = await runObsidianCli(['vault']);
    //                 expect(stdout).to.match(/^path.*notes-a\s*$/m);
    //             });
    //         })

    //         it('select vault by cwd subdir', async function () {
    //             await withCwd(path.join(vaultA!, 'foo'), async () => {
    //                 const {stdout} = await runObsidianCli(['vault']);
    //                 expect(stdout).to.match(/^path.*notes-a\s*$/m);
    //             })
    //         })

    //         it('select vault by cwd B', async function () {
    //             await withCwd(vaultBCopy!, async () => {
    //                 const {stdout} = await runObsidianCli(['vault']);
    //                 expect(stdout).to.match(/^path.*notes-b-.+$/m);
    //             })
    //         })

    //         it('no vault throws', async function () {
    //             const result = await launcher.getObsidianCli(['vault=not-a-vault', 'vault']).catch(e => e);
    //             expect(result).to.be.instanceOf(Error);
    //             expect(result.toString()).includes("No running Obsidian instance for");
    //         })
    //     })
    // }
})


describe("ObsidianLauncher login", function() {
    this.timeout("120s");

    before(async function() {
        if (process.env.TEST_LEVEL != "all" || !process.env.OBSIDIAN_PASSWORD) this.skip();
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
