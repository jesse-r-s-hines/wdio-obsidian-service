import { minSupportedObsidianVersion } from "wdio-obsidian-service"
import { pathToFileURL, fileURLToPath } from "url"
import path from "path"
import fsAsync from "fs/promises"
import semver from "semver";
import { ObsidianVersionInfo } from "obsidian-launcher"
import _ from "lodash"

const workspacePath = path.resolve(fileURLToPath(import.meta.url), "../../..")
const obsidianVersionsJson = path.join(workspacePath, "obsidian-versions.json");
const allVersions: ObsidianVersionInfo[] = JSON.parse(await fsAsync.readFile(obsidianVersionsJson, 'utf-8')).versions;
const cacheDir = path.join(workspacePath, ".obsidian-cache");
const obsidianServiceOptions = {
    versionsUrl: pathToFileURL(obsidianVersionsJson).toString(),
}

function minorVersion(v: string) {
    return v.split(".").slice(0, 2).join('.')
};

let versionsToTest: string[]
if (process.env.OBSIDIAN_VERSIONS == "all") {
    versionsToTest = allVersions
        .filter(v => !!v.downloads.apk && semver.gte(v.version, minSupportedObsidianVersion))
        .map(v => v.version);
} else if (process.env.OBSIDIAN_VERSIONS == "sample") {
    // Test every minor installer version and every minor appVersion since minSupportedObsidianVersion
    const versionMap = _(allVersions)
        .filter(v => !!v.downloads.apk && semver.gte(v.version, minSupportedObsidianVersion))
        .map(v => v.version)
        .keyBy(v => minorVersion(v)) // keyBy keeps last
        .value();
    versionMap[minorVersion(minSupportedObsidianVersion)] = minSupportedObsidianVersion;
    versionsToTest = _.values(versionMap);
    if (versionsToTest.length > 5) {
        versionsToTest = [versionsToTest[0], ...versionsToTest.slice(-4)];
    }
} else if (process.env.OBSIDIAN_VERSIONS) {
    versionsToTest = process.env.OBSIDIAN_VERSIONS.split(/[ ,]+/).map(v => {
        return v == "min-supported" ? minSupportedObsidianVersion : v;
    })
} else {
    versionsToTest = [minSupportedObsidianVersion, "latest"];
}

export const config: WebdriverIO.Config = {
    runner: 'local',
    maxInstances: 1,
    specs: ['./test/e2e/**/*.ts'],

    hostname: process.env.APPIUM_HOST || 'localhost',
    port: parseInt(process.env.APPIUM_PORT || "4723"),

    capabilities: versionsToTest
        .map((appVersion) => ({
            browserName: "obsidian",
            browserVersion: appVersion,
            platformName: 'Android',
            'appium:automationName': 'UiAutomator2',
            'appium:avd': "android_obsidian_test",
            'appium:fullReset': true,
            'wdio:obsidianOptions': {
                vault: 'test/vaults/basic',
                plugins: [
                    "./test/plugins/basic-plugin",
                ],
                themes: [
                    "./test/themes/basic-theme",
                ],
            },
        })),

    services: [
        ["obsidian", obsidianServiceOptions],
        ["appium", {
            args: { allowInsecure: "chromedriver_autodownload,adb_shell" },
        }],
    ],

    cacheDir: cacheDir,

    framework: 'mocha',
    
    reporters: ["obsidian"],

    bail: 4,

    mochaOpts: {
        ui: 'bdd',
        timeout: 300 * 1000,
    },

    logLevel: "warn",

    injectGlobals: false,
}
