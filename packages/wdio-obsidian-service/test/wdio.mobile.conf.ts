import { minSupportedObsidianVersion } from "wdio-obsidian-service"
import semver from "semver";
import _ from "lodash"
import {
    minorVersion, obsidianServiceOptions, getCapabilities, config as sharedConfig, allVersions,
} from "./wdio.shared.conf.js";

let versionsToTest: string[]
const minSupportedObsidianAndroidVersion = allVersions
    .find(v => !!v.downloads.apk && semver.gte(v.version, minSupportedObsidianVersion))!
    .version;

if (process.env.OBSIDIAN_VERSIONS == "all") {
    versionsToTest = allVersions
        .filter(v => !!v.downloads.apk && semver.gte(v.version, minSupportedObsidianAndroidVersion))
        .map(v => v.version);
} else if (process.env.OBSIDIAN_VERSIONS == "sample") {
    // Get every minor installer version and every minor appVersion since minSupportedObsidianAndroidVersion
    const versionMap = _(allVersions)
        .filter(v => !!v.downloads.apk && semver.gte(v.version, minSupportedObsidianAndroidVersion))
        .map(v => v.version)
        .keyBy(v => minorVersion(v)) // keyBy keeps last
        .value();
    versionMap[minorVersion(minSupportedObsidianAndroidVersion)] = minSupportedObsidianAndroidVersion;
    versionsToTest = _.values(versionMap);
    versionsToTest = [versionsToTest[0], ...versionsToTest.slice(Math.max(versionsToTest.length - 2, 1))];
} else if (process.env.OBSIDIAN_VERSIONS) {
    versionsToTest = process.env.OBSIDIAN_VERSIONS.split(/[ ,]+/).map(v => {
        return v == "earliest" ? minSupportedObsidianAndroidVersion : v;
    })
} else {
    versionsToTest = [minSupportedObsidianAndroidVersion, "latest"];
}

export const config: WebdriverIO.Config = _.merge({}, sharedConfig, {
    maxInstances: 1,

    hostname: process.env.APPIUM_HOST || 'localhost',
    port: parseInt(process.env.APPIUM_PORT || "4723"),

    capabilities: versionsToTest.flatMap((version) => getCapabilities(undefined, {
        browserVersion: version,
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:avd': "obsidian_test",
        'appium:noReset': true,
        'appium:appWaitDuration': 5 * 60 * 1000,
        'appium:androidInstallTimeout': 5 * 60 * 1000,
        'appium:adbExecTimeout': 60 * 1000,
    })),

    services: [
        ["obsidian", obsidianServiceOptions],
        ["appium", {
            args: { allowInsecure: "*:chromedriver_autodownload,*:adb_shell" },
        }],
    ],

    bail: 2,
    mochaOpts: {
        timeout: 300 * 1000,
    },
    // TODO: Temporary workaround for flaky appium timeouts
    specFileRetries: 3,
    specFileRetriesDelay: 10,
})
