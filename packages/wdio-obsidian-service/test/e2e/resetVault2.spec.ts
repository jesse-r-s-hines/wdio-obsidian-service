import { browser, expect } from '@wdio/globals'
import { obsidianPage } from 'wdio-obsidian-service';
import fsAsync from "fs/promises"
import path from "path"
import { getAllFiles, createDirectory } from '../helpers.js';

// resetVault tests are split into 2 files so they parallelize better

describe("resetVault2", function() {
    it("new vault", async () => {
        await browser.reloadObsidian({ vault: "./test/vaults/basic" });
        await obsidianPage.resetVault("./test/vaults/nested");
        expect(await getAllFiles({content: true})).toEqual({
            'A.md': {content: "File A\n"},
            'B/C.md': {content: "File C\n"},
            'B/D/E.md': {content: "File E\n"},
        });
    })

    it("object", async () => {
        await browser.reloadObsidian({ vault: "./test/vaults/nested" });
        const vault = {
            "Leviathan Wakes.md": "2011",
            "Calibans War.md": "2012",
            "Abaddons Gate.md": "2013",
        }
        await obsidianPage.resetVault(vault);
        expect(await getAllFiles({content: true})).toEqual({
            "Leviathan Wakes.md": {content: "2011"},
            "Calibans War.md": {content: "2012"},
            "Abaddons Gate.md": {content: "2013"},
        });
    })

    it("merge", async () => {
        await browser.reloadObsidian({ vault: "./test/vaults/basic" });
        await obsidianPage.resetVault("./test/vaults/nested", {
            "B/C.md": "updated",
            "Z.md": "new",
        });
        expect(await getAllFiles({content: true})).toEqual({
            'A.md': {content: "File A\n"},
            'B/C.md': {content: "updated"},
            'B/D/E.md': {content: "File E\n"},
            "Z.md": {content: "new"},
        });
    })

    it("hidden files", async () => {
        await browser.reloadObsidian({ vault: "./test/vaults/basic" });
        await obsidianPage.resetVault("./test/vaults/nested", {
            ".file": "hidden file",
            ".folder/bar.md": "hidden folder",
        });
        expect(await getAllFiles({content: true})).toEqual({
            "A.md": {content: "File A\n"},
            "B/C.md": {content: "File C\n"},
            "B/D/E.md": {content: "File E\n"},
            ".file": {content: "hidden file"},
            ".folder/bar.md": {content: "hidden folder"},
        });
        await obsidianPage.resetVault("./test/vaults/nested");
        expect(await getAllFiles({content: true})).toEqual({
            "A.md": {content: "File A\n"},
            "B/C.md": {content: "File C\n"},
            "B/D/E.md": {content: "File E\n"},
        });

        // You can modify .obsidian files explicitly, though it isn't recommended
        await obsidianPage.resetVault("./test/vaults/nested", {
            ".obsidian/foo.json": "{}",
        });
        const files = await getAllFiles({content: true, config: true});
        expect(files['.obsidian/foo.json'].content).toEqual("{}");
    })

    it("empty folder", async () => {
        const vault = await createDirectory();
        await fsAsync.mkdir(path.join(vault, 'foo'));

        await browser.reloadObsidian({ vault: "./test/vaults/basic" });
        await obsidianPage.resetVault(vault);

        const files = await getAllFiles({folders: true});
        expect(files).toEqual({"foo": {type: "folder"}});
    })
})
