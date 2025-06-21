import { minSupportedObsidianVersion } from "wdio-obsidian-service"
import ObsidianLauncher from "obsidian-launcher";
import { pathToFileURL, fileURLToPath } from "url"
import path from "path"
import fsAsync from "fs/promises"
import semver from "semver";
import { ObsidianVersionInfo } from "obsidian-launcher"
import _ from "lodash"

// Select which Obsidian versions to run. Available options:
//     latest - test latest version
//     first-and-last - test first and last version
//     sample - test first and last couple versions
//     all - test all versions
//     basic - test first and last version, only the basic launch path
const testPreset = process.env['TEST_PRESET'] ?? 'first-and-last';

const maxInstances = Number(process.env['WDIO_MAX_INSTANCES'] ?? 4);
const workspacePath = path.resolve(fileURLToPath(import.meta.url), "../../..")
const obsidianVersionsJson = path.join(workspacePath, "obsidian-versions.json");
const allVersions: ObsidianVersionInfo[] = JSON.parse(await fsAsync.readFile(obsidianVersionsJson, 'utf-8')).versions;
const minInstallerVersion = allVersions.find(v => v.version == minSupportedObsidianVersion)!.minInstallerVersion!;
const cacheDir = path.join(workspacePath, ".obsidian-cache");
const obsidianServiceOptions = {
    versionsUrl: pathToFileURL(obsidianVersionsJson).toString(),
}
const allSpecs = ['./test/e2e/**/*.ts'];
const basicSpecs = ['./test/e2e/basic.spec.ts'];

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

let versionsToTest: [string, string, string[]][]
if (process.env.OBSIDIAN_VERSIONS) {
    // Space separated list of appVersion/installerVersion, e.g. "1.7.7/latest latest/earliest"
    versionsToTest = process.env.OBSIDIAN_VERSIONS.split(/[ ,]+/).map(v => {
        const [app, installer = "earliest"] = v.split("/"); // default to earliest installer
        return [app, installer, allSpecs];
    })
} if (testPreset == "all") {
    versionsToTest = allVersions
        .filter(v => !!v.electronVersion && !v.isBeta && semver.gte(v.version, minInstallerVersion))
        .map(v => v.version)
        .map(v => [semver.gte(v, minSupportedObsidianVersion) ? v : minSupportedObsidianVersion, v, allSpecs])
    versionsToTest.push(["latest", "latest", allSpecs]);
    // And test latest beta if available
    if (await obsidianBetaAvailable(cacheDir)) {
        versionsToTest.push(["latest-beta", "latest", allSpecs]);
    }
} else if (testPreset == "sample") {
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
        allSpecs,
    ]);
    // test latest/earliest combination to make sure that minInstallerVersion is correct
    versionsToTest.push(["latest", "earliest", allSpecs]);

    // Only test first and last 3 minor versions
    if (versionsToTest.length > 4) {
        versionsToTest = [versionsToTest[0], ...versionsToTest.slice(-3)];
    }

    // And test latest beta if available
    if (await obsidianBetaAvailable(cacheDir)) {
        versionsToTest.push(["latest-beta", "latest", allSpecs]);
    }
} else if (testPreset == "first-and-last") {
    versionsToTest = [[minSupportedObsidianVersion, "earliest", allSpecs], ["latest", "latest", allSpecs]];
} else if (testPreset == "latest") {
    versionsToTest = [["latest", "latest", allSpecs]];
} else if (testPreset == "basic") {
    versionsToTest = [[minSupportedObsidianVersion, "earliest", basicSpecs], ["latest", "latest", basicSpecs]];
} else {
    throw Error(`Unknown TEST_PRESET ${testPreset}`)
}

export const config: WebdriverIO.Config = {
    runner: 'local',

    // How many instances of Obsidian should be launched in parallel during testing.
    maxInstances: maxInstances,

    capabilities: versionsToTest.map(([appVersion, installerVersion, specs]) => ({
        browserName: "obsidian",
        browserVersion: appVersion,
        "wdio:specs": specs,
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
