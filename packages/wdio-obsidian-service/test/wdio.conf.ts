import { minSupportedObsidianVersion } from "wdio-obsidian-service"
import semver from "semver";
import _ from "lodash"
import {
    minorVersion, obsidianBetaAvailable, cacheDir, obsidianServiceOptions, getCapabilities, config as sharedConfig,
    allVersions,
} from "./wdio.shared.conf.js";

const minInstallerVersion = allVersions.find(v => v.version == minSupportedObsidianVersion)!.minInstallerVersion!;

let versionsToTest: [string, string, string?][] // [app, installer, testLevel]
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
    // Get every minor installer version and every minor appVersion since minSupportedObsidianVersion
    const versionMap = _(allVersions)
        .filter(v => !!v.installers.appImage && !v.isBeta && semver.gte(v.version, minInstallerVersion))
        .map(v => v.version)
        .keyBy(v => minorVersion(v)) // keyBy keeps last
        .value();
    versionMap[minorVersion(minInstallerVersion)] = minInstallerVersion;
    versionsToTest =  _.values(versionMap).map(v =>
        [semver.gte(v, minSupportedObsidianVersion) ? v : minSupportedObsidianVersion, v]
    );
    // Only test first and last few minor versions
    versionsToTest = [versionsToTest[0], ...versionsToTest.slice(Math.max(versionsToTest.length - 2, 1))];
    if (await obsidianBetaAvailable(cacheDir)) {
        versionsToTest.push(["latest-beta", "earliest"]);
        versionsToTest.push(["latest-beta", "latest"]);
    } else {
        versionsToTest.push(["latest", "earliest"]);
        versionsToTest.push(["latest", "latest"]);
    }
} else if (process.env.OBSIDIAN_VERSIONS) {
    // Space separated list of appVersion/installerVersion, e.g. "1.7.7/latest latest/earliest"
    versionsToTest = process.env.OBSIDIAN_VERSIONS.split(/[ ,]+/).map(v => {
        let [app, installer = "earliest", testLevel] = v.split("/");
        app = app == "earliest" ? minSupportedObsidianVersion : app;
        return [app, installer, testLevel];
    })
} else {
    versionsToTest = [[minSupportedObsidianVersion, "earliest"], ["latest", "latest"]];
}

export const config: WebdriverIO.Config = _.merge({}, sharedConfig, {
    // How many instances of Obsidian should be launched in parallel during testing.
    maxInstances: Number(process.env['WDIO_MAX_INSTANCES'] ?? 4),

    capabilities: versionsToTest.flatMap(([appVersion, installerVersion, testLevel]) => [
        ...getCapabilities(testLevel, {
            browserVersion: appVersion,
            'wdio:obsidianOptions': {
                installerVersion: installerVersion,
            },
        }),
        ...getCapabilities(testLevel, {
            browserVersion: appVersion,
            'wdio:obsidianOptions': {
                installerVersion: installerVersion,
                emulateMobile: true,
            },
            'goog:chromeOptions': {
                mobileEmulation: {
                    deviceMetrics: {width: 390, height: 844}
                },
            },
        })
    ]),

    bail: 3,
    mochaOpts: {
        timeout: 60 * 1000,
        bail: 3,
    },

    services: [["obsidian", obsidianServiceOptions]],
})
