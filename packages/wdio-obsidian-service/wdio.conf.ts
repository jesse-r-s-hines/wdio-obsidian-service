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
import { sleep } from "./src/utils.js";

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
        'appium:app': "/home/jesse/Downloads/apk/Obsidian-1.8.10-debuggable.apk",
        'appium:deviceName': "Pixel_9",
        'appium:platformVersion': "15.0",
        'appium:avd': "Pixel_9",
        // 'appium:autoWebview': true,
        'appium:fullReset': true,
        'appium:chromedriverExecutableDir': path.join(cacheDir, "./appium-chromedriver"),
        'appium:autoGrantPermissions': true,
        // 'appium:permissions': [],
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
        await browser.execute("mobile: changePermissions", {
            action: "grant",
            appPackage: "md.obsidian",
            permissions: "all",
            // target: "appops", // requires adb_shell apparently?
        })


        await browser.execute("mobile: changePermissions", {
            action: "allow",
            // appPackage: "md.obsidian",
            permissions: [
                "MANAGE_EXTERNAL_STORAGE",
                "READ_EXTERNAL_STORAGE",
                "WRITE_EXTERNAL_STORAGE",
            ],
            target: "appops", // requires adb_shell apparently?
        })

        const vaultPath = path.join(workspacePath, 'packages/wdio-obsidian-service/test/vaults/basic');
        const mobileVaultsDir = "/storage/emulated/0/Documents/wdio-obsidian-service-vaults"

        // this requires the allow-insecure adb_shell arg
        // There is also a "mobile: deleteFile" option, but it seems to be bugged and doesn't
        // work on folders. See https://github.com/appium/appium-android-driver/issues/1003
        await browser.execute("mobile: shell", {
            command: "rm",
            args: ["-rf", mobileVaultsDir],
            includeStderr: true,
        })

        // const slug = crypto.randomBytes(8).toString("base64url").replace(/[-_]/g, '0');
        // const mobileVaultPath = path.join(mobileVaultsDir, `${path.basename(vaultPath)}-${slug}`)
        const mobileVaultPath = path.join(mobileVaultsDir, `${path.basename(vaultPath)}`)
        
        const vaultFiles = await fsAsync.readdir(vaultPath, {recursive: true, withFileTypes: true});
        for (const file of vaultFiles) {
            const filePath = path.relative(vaultPath, path.join(file.parentPath, file.name));
            if (file.isFile()) {
                const contents = await fsAsync.readFile(path.join(vaultPath, filePath))
                await browser.pushFile(path.join(mobileVaultPath, filePath), contents.toString('base64'));
            }
        }

        for (const file of vaultFiles) {
            const filePath = path.relative(vaultPath, path.join(file.parentPath, file.name));
            if (file.isFile()) {
                const contents = await fsAsync.readFile(path.join(vaultPath, filePath))
                await browser.pushFile(path.join(mobileVaultPath + "2", filePath), contents.toString('base64'));
            }
        }

        await browser.switchContext("WEBVIEW_md.obsidian");
        await browser.execute(async (mobileVaultPath) => {
            localStorage.setItem('mobile-external-vaults', JSON.stringify([mobileVaultPath]));
            localStorage.setItem('mobile-selected-vault', mobileVaultPath);
        }, mobileVaultPath);

        await sleep(1000) // have to sleep here or localStorage doesn't get persisted. TODO: Figure out a better way
        await browser.switchContext("NATIVE_APP");
        await browser.relaunchActiveApp();
        await browser.switchContext("WEBVIEW_md.obsidian");
    }
}
