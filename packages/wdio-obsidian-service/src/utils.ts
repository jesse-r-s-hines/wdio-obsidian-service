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

export async function fileExists(path: string) {
    try {
        await fsAsync.access(path);
        return true;
    } catch {
        return false;
    }
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
export async function uploadFolder(browser: WebdriverIO.Browser, src: string, dest: string) {
    // We should be able to just use pushFile which uploads a file to the device and automatically creates parent
    // directories. But its bugged, and doesn't escape spaces when creating the directories so we have to implement this
    // with shell hacks until its fixed. See https://github.com/appium/appium-android-driver/issues/1004
    src = path.resolve(src);
    dest = path.posix.normalize(dest).replace(/\/$/, '');

    let files = await fsAsync.readdir(src, {recursive: true, withFileTypes: true});
    files = _.sortBy(files, f => path.join(f.parentPath, f.name)); // sort files before children

    // uploadFile creates parent directories, but we'll create them here as well so empty dirs are added
    await browser.execute("mobile: shell", {command: "mkdir", args: ["-p", quote(dest)]});
    for (const file of files) {
        const srcPath = path.join(file.parentPath, file.name);
        const relPath = path.relative(src, path.join(file.parentPath, file.name));
        const destPath = path.posix.join(dest, relPath.split(path.sep).join("/"));
        if (file.isDirectory()) {
            await browser.execute("mobile: shell", {command: "mkdir", args: ["-p", quote(destPath)]});
        } else if (file.isFile()) {
            await uploadFile(browser, srcPath, destPath);
        }
    }
}


/**
 * Uploads a file to the appium device.
 * Wrapper around pushFile that works around a bug in pushFile where it doesn't escape special characters in parent
 * directory names. See https://github.com/appium/appium-android-driver/issues/1004
 */
export async function uploadFile(browser: WebdriverIO.Browser, src: string, dest: string) {
    src = path.resolve(src);
    dest = path.posix.normalize(dest);
    const slug = crypto.randomBytes(8).toString("base64url").replace(/[-_]/g, '0');
    const tmpFile = `/data/local/tmp/upload-${slug}.tmp`;
    const content = await fsAsync.readFile(src);

    await browser.pushFile(tmpFile, content.toString('base64'));
    await browser.execute("mobile: shell", {command: "mv", args: [tmpFile, quote(dest)]});
}

/**
 * Downloads a file from the appium device.
 */
export async function downloadFile(browser: WebdriverIO.Browser, src: string, dest: string) {
    src = path.posix.normalize(src);
    dest = path.resolve(dest);
    const content = Buffer.from(await browser.pullFile(src), "base64");
    await fsAsync.writeFile(dest, content);
}
