import path from "path";
import crypto from "crypto";
import fsAsync from "fs/promises";
import * as tar from "tar";
import _ from "lodash";

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
    let result = _.pickBy(cap, (v, k) => k.startsWith("appium:") && k != 'appium:options');
    result = _.mapKeys(result, (v, k) => k.slice(7))
    return {...result, ...cap['appium:options']};
}

/** Returns true if this capability is for Appium */
export function isAppium(cap: WebdriverIO.Capabilities) {
    return getAppiumOptions(cap).automationName?.toLocaleLowerCase() === 'uiautomator2';
}

/**
 * Upload multiple files at once. Uploads files as a tar for much better performance and to avoid issues with special
 * characters in names. (see https://github.com/appium/appium-android-driver/issues/1004)
 * 
 * @param opts.src Directory to copy from (-C in tar)
 * @param opts.dest Directory to copy to
 * @param opts.files Files under src to copy. Defaults to the whole dir.
 * @param opts.chunkSize Size to split the tar into while uploading (to avoid excessive RAM usage)
 */
export async function appiumUploadFiles(browser: WebdriverIO.Browser, opts: {
    src: string, dest: string, files?: string[], chunkSize?: number,
}) {
    let {
        src, dest,
        files = [src],
        chunkSize = 2 * 1024 * 1024,
    } = opts;
    src = path.resolve(src);
    dest = path.posix.normalize(dest).replace(/\/$/, '');
    files = files.map(f => path.relative(src, f) || ".");
    if (files.length == 0) return; // nothing to do

    // We'll tar the files up and then extract the tar on Android side. This is a lot faster than doing many small
    // pushFiles. Since pushFile requires sending the whole file contents as a base64 string, we'll split up the tar
    // into chunks to keep the size manageable for large vaults.

    const tmpDir = "/data/local/tmp"
    const slug = crypto.randomBytes(10).toString("base64url").replace(/[-_]/g, '0');
    const stream = tar.create({C: src, gzip: { level: 2 }}, files);

    // buffer/chunk size of the tar stream varies. Without compression it appears to be one chunk per file, splitting
    // large files at maxReadSize, plus some chunks for the header. However compression adds another layer that appears
    // to limit the output chunk size to about 16K.
    let buffers: Buffer[] = [];
    let bufferSize = 0;
    let i = 0;
    for await (const chunk of stream) {
        if (bufferSize + chunk.length > chunkSize && bufferSize > 0) {
            const data = Buffer.concat(buffers).toString('base64');
            await browser.pushFile(`${tmpDir}/${slug}-${String(i).padStart(6, '0')}.tar`, data);
            i++;
            buffers = [];
            bufferSize = 0;
        }
        buffers.push(chunk);
        bufferSize += chunk.length;
    }
    const data = Buffer.concat(buffers).toString('base64');
    await browser.pushFile(`${tmpDir}/${slug}-${String(i).padStart(6, '0')}.tar`, data);

    // extract the tar. `mobile: shell` does NOT escape arguments despite taking an argument array.
    await browser.execute("mobile: shell", {command: "sh", args: ["-c", quote(`
        mkdir -p ${quote(dest)};
        cat ${tmpDir}/${slug}-*.tar | tar -xz -C ${quote(dest)};
        rm ${tmpDir}/${slug}-*.tar;
    `)]});
}

export async function appiumDownloadFile(browser: WebdriverIO.Browser, src: string, dest: string) {
    src = path.posix.normalize(src);
    dest = path.resolve(dest);
    const content = Buffer.from(await browser.pullFile(src), "base64");
    await fsAsync.writeFile(dest, content);
}

/** Lists all files under a folder. Returns full paths. */
export async function appiumReaddir(browser: WebdriverIO.Browser, dir: string) {
    // list all files, one per line, no escaping
    const stdout: string = await browser.execute("mobile: shell", {command: "ls", args: ["-NA1", dir]});
    return stdout.split("\n").filter(f => f).map(f => path.join(dir, f)).sort();
}

/** SHA256 hash */
export async function hash(content: string|ArrayBufferLike) {
    return crypto.createHash("SHA256")
        .update(typeof content == "string" ? content : new Uint8Array(content))
        .digest("hex");
}

/** Replicate obsidian.normalizePath */
export function normalizePath(p: string) {
    p = p.replace(/([\\/])+/g, "/").replace(/(^\/+|\/+$)/g, "");
    if (p == "") {
        p = "/"
    }
    p = p.replace(/\u00A0|\u202F/g, " "); // replace special space characters
    p = p.normalize("NFC");
    return p;
}

/** Returns true if a vault file path is hidden (either it or one of it's parent directories starts with ".") */
export function isHidden(file: string) {
    return file.split("/").some(p => p.startsWith("."))
}

/** Returns true if this is a simple text file */
export function isText(file: string) {
    return [".md", ".json", ".txt", ".js"].includes(path.extname(file).toLocaleLowerCase());
}
