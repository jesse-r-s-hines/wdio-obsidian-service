import path from "path";
import crypto from "crypto";
import fsAsync from "fs/promises";
import _ from "lodash";

export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Quote string for use in shell scripts */
export function quote(input: string) {
    return `'${input.replace(/'/g, "'\\''")}'`;
}

/**
 * Gets the appium options.
 * Handles combining `"appium:foo"` and `"appium:options": {"foo": ...}` style options.
 */
export function getAppiumOptions(
    cap: WebdriverIO.Capabilities,
): Exclude<WebdriverIO.Capabilities['appium:options'], undefined> {
    let result: any = _.pickBy(cap, (v, k) => k.startsWith("appium:") && k != 'appium:options');
    result = _.mapKeys(result, (v, k) => k.slice(7))
    return {...result, ...cap['appium:options']};
}

/** Returns true if this capability is for Appium */
export function isAppium(cap: WebdriverIO.Capabilities) {
    return getAppiumOptions(cap).automationName?.toLocaleLowerCase() === 'uiautomator2';
}

/**
 * Push a folder to the appium device.
 */
export async function appiumPushFolder(browser: WebdriverIO.Browser, src: string, dest: string) {
    // We should be able to just use pushFile which uploads a file to the device and automatically creates parent
    // directories. But its bugged, and doesn't escape spaces when creating the directories so we have to implement this
    // with shell hacks until its fixed. See https://github.com/appium/appium-android-driver/issues/1004
    src = path.resolve(src);
    dest = path.posix.normalize(dest).replace(/\/$/, '');
    const slug = crypto.randomBytes(8).toString("base64url").replace(/[-_]/g, '0');
    const tmpFile = `/data/local/tmp/upload-${slug}.tmp`;

    let files = await fsAsync.readdir(src, {recursive: true, withFileTypes: true});
    files = _.sortBy(files, f => path.join(f.parentPath, f.name)); // sort files before children

    await browser.execute("mobile: shell", {command: "mkdir", args: ["-p", quote(dest)]});
    for (const file of files) {
        const srcPath = path.join(file.parentPath, file.name);
        const relPath = path.relative(src, path.join(file.parentPath, file.name));
        const destPath = path.posix.join(dest, relPath.replace("\\", "/"));
        if (file.isDirectory()) {
            await browser.execute("mobile: shell", {command: "mkdir", args: ["-p", quote(destPath)]});
        } else if (file.isFile()) {
            const content = await fsAsync.readFile(srcPath);
            await browser.pushFile(tmpFile, content.toString('base64'));
            await browser.execute("mobile: shell", {command: "mv", args: [tmpFile, quote(destPath)]});
        }
    }
}
