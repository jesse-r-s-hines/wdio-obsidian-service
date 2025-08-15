import { browser, expect } from '@wdio/globals'
import { obsidianPage } from 'wdio-obsidian-service';
import { appiumUploadFiles, appiumReaddir, quote } from '../../src/utils.js';
import fsAsync from "fs/promises";
import path from "path";
import crypto from "crypto";
import { createDirectory } from '../helpers.js';

describe("Emulate Mobile", function() {
    before(async function() {
        const platform = await obsidianPage.getPlatform();
        if (!platform.isMobile || platform.isMobileApp) this.skip();
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
    })

    it('Platform', async function() {
        const isMobile = await browser.executeObsidian(({obsidian}) => obsidian.Platform.isMobile);
        const isPhone = await browser.executeObsidian(({obsidian}) => obsidian.Platform.isMobile);
        expect(isMobile).toEqual(true);
        expect(isPhone).toEqual(true);

        const platform = await obsidianPage.getPlatform();
        expect(platform.isMobile).toEqual(true);
        expect(platform.isMobileApp).toEqual(false);
        expect(platform.isPhone).toEqual(true);
    })

    it('window size', async function() {
        const [width, height] = await browser.executeObsidian(() => {
            return [window.innerWidth, window.innerHeight];
        })
        expect([width, height]).toEqual([390, 844]);
    })
})


describe("Appium Utils", function() {
    const testDest = "/storage/emulated/0/Documents/wdio-obsidian-service-tests"

    before(async function() {
        const platform = await obsidianPage.getPlatform();
        if (!platform.isAndroidApp) this.skip();
    });

    beforeEach(async function() {
        await browser.execute("mobile: shell", {command: "rm", args: ["-rf", testDest]});
    })

    async function appiumIsDir(dir: string) {
        const result: string = await browser.execute("mobile: shell", {command: "sh", args: ["-c", quote(`
            stat ${quote(dir)} || true
        `)]});
        return result.includes("directory");
    }

    async function checkUploadSuccessful(src: string, dest: string) {
        src = path.resolve(src);

        expect(await appiumIsDir(dest));
        const srcFiles = await fsAsync.readdir(src, {recursive: true, withFileTypes: true});
        for (const file of srcFiles) {
            const srcPath = path.join(file.parentPath, file.name);
            const destPath = path.posix.join(dest, path.relative(src, srcPath));

            if (file.isDirectory()) {
                expect(await appiumIsDir(destPath)).toEqual(true);
            } else {
                const actualContent = Buffer.from(await browser.pullFile(destPath), "base64").toString('utf-8');
                const expectedContent = await fsAsync.readFile(srcPath, 'utf-8')
                expect(actualContent).toEqual(expectedContent);
            }
        }
    }

    it("basic", async function() {
        const src = "test/vaults/basic";
        await appiumUploadFiles(browser, {src, dest: testDest});
        await checkUploadSuccessful(src, testDest);
    })

    it("empty directory", async function() {
        const src = await createDirectory();
        await appiumUploadFiles(browser, {src, dest: testDest});
        await checkUploadSuccessful(src, testDest);
    })

    it("empty subdirectory", async function() {
        const src = await createDirectory();
        await fsAsync.mkdir(path.join(src, "sub"));
        await appiumUploadFiles(browser, {src, dest: testDest});
        await checkUploadSuccessful(src, testDest);
    })

    it("splitting", async function() {
        const src = await createDirectory();
        await fsAsync.writeFile(path.join(src, 'a'), await crypto.randomBytes(1024 * 1024).toString('base64'));
        await fsAsync.writeFile(path.join(src, 'b'), await crypto.randomBytes(1024).toString('base64'));
        await fsAsync.writeFile(path.join(src, 'c'), await crypto.randomBytes(1024).toString('base64'));
        await appiumUploadFiles(browser, {src, dest: testDest, chunkSize: 16 * 1024});
        await checkUploadSuccessful(src, testDest);
    })

    it("files", async function() {
        const src = await createDirectory({
            "Hello.md": "Hello world",
            "Goodbye.md": "Goodbye world",
        })
        const srcFile = path.join(src, "Goodbye.md");
        const destFile = path.posix.join(testDest, "Goodbye.md");
        await appiumUploadFiles(browser, {src, dest: testDest, files: [srcFile]});
        expect(await appiumReaddir(browser, testDest)).toEqual([destFile]);

        // overwrite
        await fsAsync.writeFile(srcFile, "FOO");
        await appiumUploadFiles(browser, {src, dest: testDest, files: [srcFile]});
        const content = Buffer.from(await browser.pullFile(destFile), "base64").toString('utf-8');
        expect(content).toEqual("FOO");
    })

    it("empty files", async function() {
        const src = "test/vaults/basic";
        await appiumUploadFiles(browser, {src, dest: testDest, files: []});
        expect(await appiumIsDir(testDest)).toEqual(false);
    })
})
