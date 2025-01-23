import { ObsidianWorkerService, ObsidianLauncherService, ObsidianReporter } from "./src/index.js"
import { pathToFileURL } from "url"
import path from "path"
import fsAsync from "fs/promises"
import semver from "semver";
import { ObsidianVersionInfo } from "./src/types.js"
import _ from "lodash"

const minInstallerVersion = "1.1.9"
const minAppVersion = "1.5.3"
const maxInstances = Number(process.env['WDIO_MAX_INSTANCES'] ?? 4);

async function getVersionsToTest() {
    const minorVersion = (v: string) => v.split(".").slice(0, 2).join('.')
    const versions: ObsidianVersionInfo[] = JSON.parse(
        await fsAsync.readFile("./obsidian-versions.json", 'utf-8')
    ).versions;
    const versionMap = _(versions)
        .filter(v => !!v.electronVersion && semver.gte(v.version, minInstallerVersion))
        .keyBy(v => minorVersion(v.version)) // keyBy keeps last
        .value();
    versionMap[minorVersion(minInstallerVersion)] = versions.find(v => v.version == minInstallerVersion)!
    // Test every minor installer version since minInstallerVersion and every minor appVersion since minAppVersion
    const versionsToTest = _.values(versionMap)
        .map(v => ({
            appVersion: semver.lte(v.version, minAppVersion) ? minAppVersion : v.version,
            installerVersion: v.version,
        }))
    // And the latest beta
    if (process.env['OBSIDIAN_PASSWORD']) {
        versionsToTest.push({appVersion: "latest-beta", installerVersion: "latest"})
    }
    return versionsToTest;
}

const obsidianServiceOptions = {
    obsidianVersionsUrl: pathToFileURL("./obsidian-versions.json").toString(),
}

export const config: WebdriverIO.Config = {
    runner: 'local',

    specs: [
        './test/e2e/**/*.ts'
    ],
   
    // How many instances of Obsidian should be launched in parallel during testing.
    maxInstances: maxInstances,

    capabilities: (await getVersionsToTest()).map(({appVersion, installerVersion}) => ({
        browserName: "obsidian",
        browserVersion: appVersion,
        'wdio:obsidianOptions': {
            installerVersion: installerVersion,
            plugins: ["./test/plugins/basic-plugin"],
        }
    })),

    services: [[ObsidianWorkerService, obsidianServiceOptions], [ObsidianLauncherService, obsidianServiceOptions]],

    cacheDir: path.resolve(".optl"),

    framework: 'mocha',
    
    reporters: [ObsidianReporter],

    mochaOpts: {
        ui: 'bdd',
        timeout: 60000
    },
}
