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
import { obsidianApiLogin } from "../../src/apis.js";
import { fileExists, maybe } from "../../src/utils.js";
import { ObsidianVersionList } from "../../src/types.js";
import { createServer } from "../helpers.js";

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
    if (process.env.TEST_LEVEL == "all") {
        versions = [ // sample a range of versions
            ..._.range(0, versions.length - 2, (versions.length - 2) / 3).map(i => versions[Math.trunc(i)]),
            ...versions.slice(-1),
            [latest, latestMinInstaller],
        ];
    } else {
        versions = [versions[0], ...versions.slice(-2), [latest, latestMinInstaller]]
    }

    before(async function() {
        this.timeout(10 * 60 * 1000);
        launcher = new ObsidianLauncher(obsidianLauncherOpts);

        // mock server that caches requests to Obsidian assets
        const server = await createServer(testData, Object.fromEntries(versionInfos.versions
            .flatMap(v => Object.values(v.downloads))
            .map(url => [url.replace(/^https?:\/\//, ''), {url}] as const)
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
            const {client, cleanup} = await getCdpSession(launcher, appVersion, installerVersion);
            after(() => cleanup());

            const actualVault = await cdpEvaluate(client, "obsidianLauncher.app.vault.adapter.getFullPath('')");
            expect(actualVault).to.match(/obsidian-vault/)
            
            const actualAppVersion = await cdpEvaluate(client, "require('electron').ipcRenderer.sendSync('version')");
            expect(actualAppVersion).to.eql(appVersion);

            const actualInstallerVersion = await cdpEvaluate(client, "require('electron').remote.app.getVersion()")
            expect(actualInstallerVersion).to.eql(installerVersion);
        });
    }
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
