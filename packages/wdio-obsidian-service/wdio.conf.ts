import { minSupportedObsidianVersion } from "wdio-obsidian-service"
import ObsidianLauncher from "obsidian-launcher";
import { pathToFileURL, fileURLToPath } from "url"
import path from "path"
import fsAsync from "fs/promises"
import semver from "semver";
import { ObsidianVersionInfo } from "obsidian-launcher"
import _ from "lodash"
import { Options } from "@wdio/types";


const cacheDir = path.join("/home/jesse/Documents/Projects/Obsidian/wdio-obsidian-service/.obsidian-cache");

export const config: WebdriverIO.Config = {
    // runner: 'local',
    maxInstances: 1,
    specs: ["./test/e2e/basic.spec.ts"],

    hostname: process.env.APPIUM_HOST || 'localhost',
    port: parseInt(process.env.APPIUM_PORT || "4723", 10),

    capabilities: [{
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        // 'appium:appPackage': 'com.android.settings',
        'appium:app': path.resolve("./Obsidian-1.8.10.apk"),
        'appium:deviceName': "Pixel_9",
        'appium:platformVersion': "15.0",
        'appium:avd': "Pixel_9",
        'appium:autoWebview': true,
        'appium:noReset': false,
        'appium:fullReset': false,
        'appium:chromedriverExecutableDir': path.join(cacheDir, "./appium-chromedriver"),
    }],

    services: [
        ['appium', {
            args: {
                allowInsecure: "chromedriver_autodownload",
            },
        }]
    ],

    mochaOpts: {
        ui: 'bdd',
        timeout: 60000
    },

    cacheDir: cacheDir,

    framework: 'mocha',
    
    logLevel: "info",

    injectGlobals: false,
}
