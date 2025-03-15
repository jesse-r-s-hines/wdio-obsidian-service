import ObsidianWorkerService, { launcher as ObsidianLauncherService, obsidianBetaAvailable } from "./src/index.js"
import { minSupportedObsidianVersion } from "./src/service.js"
import { pathToFileURL, fileURLToPath } from "url"
import path from "path"
import fsAsync from "fs/promises"
import semver from "semver";
import { ObsidianVersionInfo } from "obsidian-launcher"
import _ from "lodash"

// Select which Obsidian versions to run. Available options
// all, sample, first-and-last, last
const testPreset = process.env['TEST_PRESET'] ?? 'first-and-last';

const maxInstances = Number(process.env['WDIO_MAX_INSTANCES'] ?? 4);
const workspacePath = path.resolve(path.join(fileURLToPath(import.meta.url), "../../.."))
const obsidianVersionsJson = path.join(workspacePath, "obsidian-versions.json");
const allVersions: ObsidianVersionInfo[] = JSON.parse(await fsAsync.readFile(obsidianVersionsJson, 'utf-8')).versions;
const minInstallerVersion = allVersions.find(v => v.version == minSupportedObsidianVersion)!.minInstallerVersion!;
const cacheDir = path.join(workspacePath, ".obsidian-cache");
const obsidianServiceOptions = {
    versionsUrl: pathToFileURL(obsidianVersionsJson).toString(),
}

const minorVersion = (v: string) => v.split(".").slice(0, 2).join('.');

let versionsToTest: [string, string][]
if (process.env.OBSIDIAN_VERSIONS) {
    // Space separated list of appVersion/installerVersion, e.g. "1.7.7/latest latest/earliest"
    versionsToTest = process.env.OBSIDIAN_VERSIONS.split(/[ ,]+/).map(v => {
        const [app, installer = "earliest"] = v.split("/"); // default to earliest installer
        return [app, installer];
    })
} else if (['all', 'sample'].includes(testPreset)) {
    // Test every minor installer version and every minor appVersion since minSupportedObsidianVersion
    const versionMap = _(allVersions)
        .filter(v => !!v.electronVersion && !v.isBeta && semver.gte(v.version, minInstallerVersion))
        .map(v => v.version)
        .keyBy(v => minorVersion(v)) // keyBy keeps last
        .value();
    versionMap[minorVersion(minInstallerVersion)] = minInstallerVersion;
    versionsToTest =  _.values(versionMap).map(v => [
        semver.gte(v, minSupportedObsidianVersion) ? v : minSupportedObsidianVersion,
        v,
    ]);
    // test latest/earliest combination to make sure that minInstallerVersion is correct
    versionsToTest.push(["latest", "earliest"]);

    // Only test first and last 4 minor versions
    if (testPreset == "sample" && versionsToTest.length > 5) {
        versionsToTest = [versionsToTest[0], ...versionsToTest.slice(-4)];
    }

    // And test latest beta if available
    if (await obsidianBetaAvailable(cacheDir)) {
        versionsToTest.push(["latest-beta", "latest"]);
    }
} else if (testPreset == "first-and-last") {
    versionsToTest = [[minSupportedObsidianVersion, "earliest"], ["latest", "latest"]];
} else if (testPreset == "last") {
    versionsToTest = [["latest", "latest"]]
} else {
    throw Error(`Unknown TEST_PRESET ${testPreset}`)
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
    
    reporters: ["obsidian"],

    mochaOpts: {
        ui: 'bdd',
        timeout: 60000
    },

    logLevel: "warn",
}
