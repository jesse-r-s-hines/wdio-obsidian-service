import { minSupportedObsidianVersion } from "wdio-obsidian-service"
import ObsidianLauncher from "obsidian-launcher";
import { pathToFileURL, fileURLToPath } from "url"
import path from "path"
import fsAsync from "fs/promises"
import semver from "semver";
import { ObsidianVersionInfo } from "obsidian-launcher"
import _ from "lodash"
import type { Capabilities, Options, Services } from '@wdio/types'
import crypto from "crypto";

const workspacePath = path.resolve(fileURLToPath(import.meta.url), "../../..");
const cacheDir = path.join(workspacePath, ".obsidian-cache");

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
        'appium:app': "/home/jesse/Downloads/apk/Obsidian-1.8.10.apk",
        'appium:deviceName': "Pixel_9",
        'appium:platformVersion': "15.0",
        'appium:avd': "Pixel_9",
        'appium:autoWebview': true,
        'appium:fullReset': true,
        'appium:chromedriverExecutableDir': path.join(cacheDir, "./appium-chromedriver"),
    }],

    services: [
        ['appium', {
            args: {
                allowInsecure: "chromedriver_autodownload,adb_shell",
            },
        }]
    ],

    mochaOpts: {
        ui: 'bdd',
        timeout: 600000
    },

    cacheDir: cacheDir,

    framework: 'mocha',
    
    logLevel: "info",

    injectGlobals: false,

    async onPrepare(config: Options.Testrunner, capabilities: Capabilities.TestrunnerCapabilities) {

    },

    async beforeSession(config: Options.Testrunner, capabilities: WebdriverIO.Capabilities) {
    },

    async before(capabilities: WebdriverIO.Capabilities, specs: unknown, browser: WebdriverIO.Browser) {
        const vaultPath = path.join(workspacePath, 'packages/wdio-obsidian-service/test/vaults/basic');
        const mobileVaultsDir = "/storage/emulated/0/Documents/wdio-obsidian-service-vaults"

        // this requires the allow-insecure adb_shell arg
        // There is also a "mobile: deleteFile" option, but it seems to be bugged and doesn't
        // work on folders. See https://github.com/appium/appium-android-driver/issues/1003
        await browser.executeScript("mobile: shell", [{
            command: "rm",
            args: ["-rf", mobileVaultsDir],
            includeStderr: true,
        }])

        const slug = crypto.randomBytes(8).toString("base64url").replace(/[-_]/g, '0');
        const mobileVaultPath = path.join(mobileVaultsDir, `${path.basename(vaultPath)}-${slug}`)
        
        const vaultFiles = await fsAsync.readdir(vaultPath, {recursive: true, withFileTypes: true});
        for (const file of vaultFiles) {
            const filePath = path.relative(vaultPath, path.join(file.parentPath, file.name));
            if (file.isFile()) {
                const contents = await fsAsync.readFile(path.join(vaultPath, filePath))
                await browser.pushFile(path.join(mobileVaultPath, filePath), contents.toString('base64'));
            }
        }
    }
}
