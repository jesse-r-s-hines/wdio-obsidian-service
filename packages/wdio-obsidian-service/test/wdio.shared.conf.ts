import _ from "lodash";
import path from "path"
import fsAsync from "fs/promises"
import { pathToFileURL, fileURLToPath } from "url"
import ObsidianLauncher, { ObsidianVersionInfo } from "obsidian-launcher";

const workspacePath = path.resolve(fileURLToPath(import.meta.url), "../../../..")
const obsidianVersionsJson = path.join(workspacePath, "obsidian-versions.json");

export const allVersions: ObsidianVersionInfo[] = JSON.parse(await fsAsync.readFile(obsidianVersionsJson, 'utf-8')).versions;

export function minorVersion(v: string) {
    return v.split(".").slice(0, 2).join('.')
};

/**
 * Can't use the regular obsidianBetaAvailable as it fetches the obsidian-versions.json instead of using the local one
 */
export async function obsidianBetaAvailable(cacheDir?: string) {
    const launcher = new ObsidianLauncher({
        cacheDir: cacheDir,
        versionsUrl: obsidianServiceOptions.versionsUrl,
    });
    const versionInfo = await launcher.getVersionInfo("latest-beta");
    return versionInfo.isBeta && await launcher.isAvailable(versionInfo.version);
}

export const cacheDir = path.join(workspacePath, ".obsidian-cache");

export const obsidianServiceOptions = {
    versionsUrl: pathToFileURL(obsidianVersionsJson).toString(),
}

export const getCapabilities = (testLevel?: string, overrides?: WebdriverIO.Capabilities) => {
    testLevel = testLevel ?? process.env.TEST_LEVEL ?? 'standard';

    const base: WebdriverIO.Capabilities = {
        browserName: "obsidian",
        'wdio:obsidianOptions': {
            plugins: [
                "./plugins/basic-plugin",
            ],
            themes: [
                "./themes/basic-theme",
            ],
        },
    }
    const caps: WebdriverIO.Capabilities[] = [
        _.merge({}, base, { // basic.spec.ts
            'wdio:obsidianOptions': {
                vault: "./vaults/basic",
            },
            'wdio:exclude': ['!(basic.spec.ts)'], // --spec command overrides wdio:specs, so use wdio:exclude instead
        }),
    ];
    if (testLevel != 'basic') {
        caps.push(_.merge({}, base, { // all other specs
            'wdio:exclude': ["e2e/basic.spec.ts"],
        }))
    }
    return caps.map(c => _.merge({}, c, overrides));
}

export const config: WebdriverIO.Config = {
    runner: 'local',
    specs: ['./e2e/**/*.ts'],

    capabilities: [],

    services: [["obsidian", obsidianServiceOptions]],
    cacheDir: cacheDir,
    framework: 'mocha',
    reporters: ["obsidian"],

    bail: 2,
    mochaOpts: {
        timeout: 5 * 60 * 1000,
        bail: 2,
    },

    logLevel: "warn",

    injectGlobals: false,
}
