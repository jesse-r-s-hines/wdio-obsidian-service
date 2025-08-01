import { minSupportedObsidianVersion } from "wdio-obsidian-service"
import ObsidianLauncher from "obsidian-launcher";
import { pathToFileURL, fileURLToPath } from "url"
import path from "path"
import fsAsync from "fs/promises"
import semver from "semver";
import { ObsidianVersionInfo } from "obsidian-launcher"
import _ from "lodash"

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
        .filter(v => !!v.installers.appImage && !v.isBeta && semver.gte(v.version, minInstallerVersion))
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
        app = app == "earliest" ? minSupportedObsidianVersion : app;
        return [app, installer];
    })
} else {
    versionsToTest = [[minSupportedObsidianVersion, "earliest"], ["latest", "latest"]];
}

export const config: WebdriverIO.Config = {
    runner: 'local',

    // How many instances of Obsidian should be launched in parallel during testing.
    maxInstances: maxInstances,
    specs: ['./test/e2e/**/*.ts'],

    capabilities: versionsToTest.flatMap(([appVersion, installerVersion]) => {
        const excludeBasic = 'test/e2e/basic.spec.ts';
        const excludeRest = '!(basic.spec.ts)';

        const cap: WebdriverIO.Capabilities = {
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
            },
        }
        const emulateMobileOptions: WebdriverIO.Capabilities = {
            'wdio:obsidianOptions': {
                emulateMobile: true,
            },
            'goog:chromeOptions': {
                mobileEmulation: {
                    deviceMetrics: {width: 390, height: 844}
                },
            },
        }
        const caps: WebdriverIO.Capabilities[] = [
            _.merge({}, cap, { // separate capability for basic tests, test passing vault in the capability
                'wdio:exclude': [excludeRest], // --spec command overrides wdio:specs, so use wdio:exclude instead
                'wdio:obsidianOptions': { vault: 'test/vaults/basic' },
            }),
            _.merge({}, cap, emulateMobileOptions, {
                'wdio:exclude': [excludeRest],
                'wdio:obsidianOptions': { vault: 'test/vaults/basic' },
            }),
        ]
        if (process.env.TEST_PRESET != 'basic') {
            caps.push(
                _.merge({}, cap, { 'wdio:exclude': [excludeBasic] }),
                _.merge({}, cap, emulateMobileOptions, { 'wdio:exclude': [excludeBasic] }),
            )
        }
        return caps;
    }),

    services: [["obsidian", obsidianServiceOptions]],

    cacheDir: cacheDir,

    framework: 'mocha',
    
    reporters: ["obsidian"],

    bail: 3,

    mochaOpts: {
        ui: 'bdd',
        timeout: 60 * 1000,
        bail: 3,
    },

    logLevel: "warn",

    injectGlobals: false,
}
