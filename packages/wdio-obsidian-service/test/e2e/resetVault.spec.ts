import { browser, expect } from '@wdio/globals'
import { obsidianPage } from 'wdio-obsidian-service';
import { TFile } from 'obsidian';
import os from "os";
import fsAsync from "fs/promises"
import path from "path"


describe("resetVault", function() {
    async function getAllFiles(opts: {content?: boolean, mtime?: boolean, config?: boolean}) {
        type FileInfo = {content?: string, mtime?: number}
        return await browser.executeObsidian(async ({ app }, opts) => {
            async function listRecursive(path: string): Promise<Record<string, FileInfo>> {
                const result: Record<string, FileInfo> = {};
                const { folders, files } = await app.vault.adapter.list(path);
                for (const folder of folders) {
                    Object.assign(result, await listRecursive(folder));
                }
                for (const file of files) {
                    if (opts.config || !file.startsWith(".obsidian/")) {
                        const fileInfo: FileInfo = {};
                        if (opts.content) {
                            fileInfo.content = (await app.vault.adapter.read(file)).replace(/\r\n/g, '\n');
                        }
                        if (opts.mtime) {
                            fileInfo.mtime = (await app.vault.adapter.stat(file))!.mtime;
                        }
                        result[file] = fileInfo;
                    }
                }
                return result;
            }
            return listRecursive("/");
        }, opts);
    }

    it("no vault open", async () => {
        await obsidianPage.resetVault({ "foo.md": "BAR" });
        expect(await getAllFiles({content: true})).toEqual({ "foo.md": {content: "BAR"} });
    })

    it("no change", async () => {
        await browser.reloadObsidian({ vault: "./test/vaults/basic" });
        await browser.pause(2000); // make sure Obsidian has written out it's config files
        const allFilesBefore = await getAllFiles({content: true, config: true});
        const vaultFilesBefore = await getAllFiles({content: true, mtime: true});
        expect(Object.keys(vaultFilesBefore).sort()).toEqual(["Goodbye.md", "Welcome.md"]);
        await obsidianPage.resetVault();
        const allFilesAfter = await getAllFiles({content: true, config: true});
        const vaultFilesAfter = await getAllFiles({content: true, mtime: true});
        expect(vaultFilesAfter).toEqual(vaultFilesBefore); // should not update files that don't need to be changed
        // should not mess with the config
        expect(allFilesAfter).toEqual(allFilesBefore);
    })

    it("update file", async () => {
        await browser.reloadObsidian({ vault: "./test/vaults/basic" });
        const filesBefore = await getAllFiles({content: true});

        await browser.executeObsidian(async ({ app }) => {
            await app.vault.modify(app.vault.getAbstractFileByPath("Welcome.md") as TFile, "changed");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles({content: true})).toEqual(filesBefore);
    })

    it("remove and create files", async () => {
        await browser.reloadObsidian({ vault: "./test/vaults/basic" });
        const filesBefore = await getAllFiles({content: true});

        await browser.executeObsidian(async ({ app }) => {
            await app.vault.delete(app.vault.getAbstractFileByPath("Welcome.md") as TFile);
            await app.vault.create("New.md", "A new file");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles({content: true})).toEqual(filesBefore);
    })

    it("update file nested", async () => {
        await browser.reloadObsidian({ vault: "./test/vaults/nested" });
        const filesBefore = await getAllFiles({content: true});

        await browser.executeObsidian(async ({ app }) => {
            await app.vault.modify(app.vault.getAbstractFileByPath("B/C.md") as TFile, "changed");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles({content: true})).toEqual(filesBefore);
    })

    it("remove and create files nested", async () => {
        await browser.reloadObsidian({ vault: "./test/vaults/basic" });
        const filesBefore = await getAllFiles({content: true});

        await browser.executeObsidian(async ({ app }) => {
            await app.vault.delete(app.vault.getAbstractFileByPath("B/C.md") as TFile);
            await app.vault.create("New.md", "A new file");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles({content: true})).toEqual(filesBefore);
    })

    it("empty vault", async () => {
        await browser.reloadObsidian({ vault: "./test/vaults/empty" });
        await obsidianPage.resetVault();
        expect(await getAllFiles({content: true})).toEqual({});

        await browser.executeObsidian(async ({ app }) => {
            await app.vault.create("New.md", "A new file");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles({content: true})).toEqual({});
    })

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
    })

    it("Empty folder", async () => {
        const tmpDir = await fsAsync.mkdtemp(path.join(os.tmpdir(), "mocha-"));
        after(async () => { await fsAsync.rm(tmpDir, { recursive: true, force: true }); });
        await fsAsync.mkdir(path.join(tmpDir, 'foo'));

        await browser.reloadObsidian({ vault: "./test/vaults/basic" });

        await obsidianPage.resetVault(tmpDir);
        const {folders, files} = await browser.executeObsidian(({app}) => app.vault.adapter.list("/"));
        expect(folders).toEqual(["foo"]);
        expect(files).toEqual([]);
    })
})
