import ObsidianWorkerService, { launcher as ObsidianLauncherService, obsidianBetaAvailable } from "./src/index.js"
import ObsidianReporter from "./src/obsidianReporter.js"
import { pathToFileURL } from "url"
import path from "path"
import fsAsync from "fs/promises"
import semver from "semver";
import { ObsidianVersionInfo } from "obsidian-launcher"
import _ from "lodash"

const minAppVersion = "1.5.3";
const maxInstances = Number(process.env['WDIO_MAX_INSTANCES'] ?? 4);
const testEnv = process.env['TEST_ENV'] ?? 'local';
const obsidianVersionsJson = path.resolve("../../obsidian-versions.json");
const allVersions: ObsidianVersionInfo[] = JSON.parse(await fsAsync.readFile(obsidianVersionsJson, 'utf-8')).versions;
const minInstallerVersion = allVersions.find(v => v.version == minAppVersion)!.minInstallerVersion;
const cacheDir = path.resolve(".obsidian-cache");
const obsidianServiceOptions = {
    versionsUrl: pathToFileURL(obsidianVersionsJson).toString(),
}

const minorVersion = (v: string) => v.split(".").slice(0, 2).join('.');

let versionsToTest: [string, string][]
if (process.env['OBSIDIAN_VERSIONS']) {
    const appVersions = process.env['OBSIDIAN_VERSIONS'].trim().split(/[ ,]+/);
    const installerVersions = process.env['OBSIDIAN_INSTALLER_VERSIONS']?.trim().split(/[ ,]+/) ?? [];
    versionsToTest = appVersions.map((v, i) => [v, installerVersions[i] ?? 'earliest']);
} else if (['local', 'ubuntu-latest', 'windows-latest'].includes(testEnv)) {
    // Test every minor installer version since minInstallerVersion and every minor appVersion since minAppVersion
    const versionMap = _(allVersions)
        .filter(v => !!v.electronVersion && !v.isBeta && semver.gte(v.version, minInstallerVersion))
        .map(v => v.version)
        .keyBy(v => minorVersion(v)) // keyBy keeps last
        .value();
    versionMap[minorVersion(minInstallerVersion)] = minInstallerVersion;
    versionsToTest =  _.values(versionMap).map(v => [semver.gte(v, minAppVersion) ? v : minAppVersion, v]);

    // And test latest beta
    const betaExists = allVersions.at(-1)!.isBeta;
    const betaRequired = (testEnv != 'local');
    const betaAvailable = await obsidianBetaAvailable(cacheDir);
    if (betaExists && (betaAvailable || betaRequired)) {
        versionsToTest.push(["latest-beta", "latest"]);
        if (!betaAvailable) {
            console.error('\x1b[31m%s\x1b[0m', // red ANSI codes
                "WARNING: Workflows run on PRs don't have the credentials to download Obsidian beta versions and the " +
                "beta is not in the workflow cache. Try again in an hour or two and the cache should be initialied."
            );
        }
    }
} else if (testEnv == "macos-latest") {
    // MacOS runners cost 10x of our GitHub actions quota compared to ubuntu, so only run min and latest.
    versionsToTest = [[minAppVersion, "earliest"], ["latest", "latest"]];
} else {
    throw Error(`Unknown TEST_ENV ${testEnv}`)
}

export const config: WebdriverIO.Config = {
    runner: 'local',

    specs: [
        './test/e2e/**/*.ts'
    ],
   
    // How many instances of Obsidian should be launched in parallel during testing.
    maxInstances: maxInstances,

    capabilities: versionsToTest.map(([appVersion, installerVersion]) => ({
        browserName: "obsidian",
        browserVersion: appVersion,
        'wdio:obsidianOptions': {
            installerVersion: installerVersion,
            plugins: [
                "./test/plugins/basic-plugin",
            ],
            themes: [
                "./test/themes/basic-theme",
            ],
        }
    })),

    services: [[ObsidianWorkerService, obsidianServiceOptions], [ObsidianLauncherService, obsidianServiceOptions]],

    cacheDir: cacheDir,

    framework: 'mocha',
    
    reporters: [ObsidianReporter],

    mochaOpts: {
        ui: 'bdd',
        timeout: 60000
    },

    logLevel: "warn",
}
