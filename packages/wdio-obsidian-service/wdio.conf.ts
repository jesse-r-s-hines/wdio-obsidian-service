import { minSupportedObsidianVersion } from "wdio-obsidian-service"
import ObsidianLauncher from "obsidian-launcher";
import { pathToFileURL, fileURLToPath } from "url"
import path from "path"
import fsAsync from "fs/promises"
import semver from "semver";
import { ObsidianVersionInfo } from "obsidian-launcher"
import _ from "lodash"

let specs: string[];
if (process.env.TEST_PRESET == "basic") {
    specs = ['./test/e2e/basic.spec.ts'];
} else {
    specs = ['./test/e2e/**/*.ts'];
}
const maxInstances = Number(process.env['WDIO_MAX_INSTANCES'] ?? 4);
const workspacePath = path.resolve(fileURLToPath(import.meta.url), "../../..")
const obsidianVersionsJson = path.join(workspacePath, "obsidian-versions.json");
const allVersions: ObsidianVersionInfo[] = JSON.parse(await fsAsync.readFile(obsidianVersionsJson, 'utf-8')).versions;
const minInstallerVersion = allVersions.find(v => v.version == minSupportedObsidianVersion)!.minInstallerVersion!;
const cacheDir = path.join(workspacePath, ".obsidian-cache");
const obsidianServiceOptions = {
    versionsUrl: pathToFileURL(obsidianVersionsJson).toString(),
}

/**
 * Can't use the regular obsidianBetaAvailable as it fetches the obsidian-versions.json instead of using the local one
 */
async function obsidianBetaAvailable(cacheDir?: string) {
    const launcher = new ObsidianLauncher({
        cacheDir: cacheDir,
        versionsUrl: obsidianServiceOptions.versionsUrl,
    });
    const versionInfo = await launcher.getVersionInfo("latest-beta");
    return versionInfo.isBeta && await launcher.isAvailable(versionInfo.version);
}

function minorVersion(v: string) {
    return v.split(".").slice(0, 2).join('.')
};

let versionsToTest: [string, string][]
if (process.env.OBSIDIAN_VERSIONS == "all") {
    versionsToTest = allVersions
        .filter(v => !v.isBeta && semver.gte(v.version, minInstallerVersion))
        .map(v => v.version)
        .flatMap(v => {
            if (semver.lte(v, minSupportedObsidianVersion)) {
                return [[minSupportedObsidianVersion, v]];
            } else {
                return [[v, "earliest"], [v, "latest"]];
            }
        })
    if (await obsidianBetaAvailable(cacheDir)) {
        versionsToTest.push(["latest-beta", "latest"]);
    }
} else if (process.env.OBSIDIAN_VERSIONS == "sample") {
    // Test every minor installer version and every minor appVersion since minSupportedObsidianVersion
    const versionMap = _(allVersions)
        .filter(v => !!v.installerInfo.appImage && !v.isBeta && semver.gte(v.version, minInstallerVersion))
        .map(v => v.version)
        .keyBy(v => minorVersion(v)) // keyBy keeps last
        .value();
    versionMap[minorVersion(minInstallerVersion)] = minInstallerVersion;
    versionsToTest =  _.values(versionMap).map(v =>
        [semver.gte(v, minSupportedObsidianVersion) ? v : minSupportedObsidianVersion, v]
    );
    // test latest/earliest combination to make sure that minInstallerVersion is correct
    versionsToTest.push(["latest", "earliest"]);
    // Only test first and last few minor versions
    if (versionsToTest.length > 5) {
        versionsToTest = [versionsToTest[0], ...versionsToTest.slice(-4)];
    }
    if (await obsidianBetaAvailable(cacheDir)) {
        versionsToTest.push(["latest-beta", "latest"]);
    }
} else if (process.env.OBSIDIAN_VERSIONS) {
    // Space separated list of appVersion/installerVersion, e.g. "1.7.7/latest latest/earliest"
    versionsToTest = process.env.OBSIDIAN_VERSIONS.split(/[ ,]+/).map(v => {
        let [app, installer = "earliest"] = v.split("/"); // default to earliest installer
        if (app == "min-supported") {
            app = minSupportedObsidianVersion;
        }
        return [app, installer];
    })
} else {
    versionsToTest = [[minSupportedObsidianVersion, "earliest"], ["latest", "latest"]];
}

export const config: WebdriverIO.Config = {
    runner: 'local',

    // How many instances of Obsidian should be launched in parallel during testing.
    maxInstances: maxInstances,

    capabilities: versionsToTest
        .flatMap(v => [[...v, false], [...v, true]] as const)
        .map(([appVersion, installerVersion, emulateMobile]) => ({
            browserName: "obsidian",
            browserVersion: appVersion,
            "wdio:specs": specs,
            'wdio:obsidianOptions': {
                emulateMobile: emulateMobile,
                installerVersion: installerVersion,
                plugins: [
                    "./test/plugins/basic-plugin",
                ],
                themes: [
                    "./test/themes/basic-theme",
                ],
            },
            'goog:chromeOptions': {
                mobileEmulation: emulateMobile ? {deviceMetrics: {width: 390, height: 844}} : undefined,
            },
        })),

    services: [["obsidian", obsidianServiceOptions]],

    cacheDir: cacheDir,

    framework: 'mocha',
    
    reporters: ["obsidian"],

    bail: 4,

    mochaOpts: {
        ui: 'bdd',
        timeout: 60000
    },

    logLevel: "warn",

    injectGlobals: false,
}
