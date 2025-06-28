import {remote} from 'webdriverio';
import * as path from 'path'

async function runTest() {
    const driver = await remote({
        hostname: process.env.APPIUM_HOST || 'localhost',
        port: parseInt(process.env.APPIUM_PORT, 10) || 4723,
        logLevel: 'info',
        capabilities: {
            platformName: 'Android',
            'appium:automationName': 'UiAutomator2',
            // 'appium:appPackage': 'com.android.settings',
            'appium:app': path.resolve("./Obsidian-1.8.10.apk"),
            'appium:deviceName': "Pixel_9",
            'appium:platformVersion': "15.0",
            'appium:avd': "Pixel_9",
            'appium:autoWebview': true,
            'appium:noReset': true,
            'appium:dontStopAppOnReset': true,
            'appium:chromedriverExecutableDir': path.resolve("./appium-chromedriver-downloads")
        }
    });
    // console.log("Waiting...")
    await new Promise(r => setInterval(r, 2 * 1000));
    // console.log("Done waiting...")
    try {
        // const batteryItem = await driver.$('//*[@text="Battery"]');
        // await batteryItem.click();
        const elem = await driver.$("body");
        // console.log(elem, await elem.getHTML())
        console.log('body', await elem.isExisting())
        console.log(await driver.execute(() => "EXECUTED"))

    } finally {
        await driver.pause(1000);
        await driver.deleteSession();
    }
}

runTest().catch(console.error);