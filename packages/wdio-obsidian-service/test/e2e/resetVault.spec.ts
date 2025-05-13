import { browser, expect } from '@wdio/globals'
import { obsidianPage } from 'wdio-obsidian-service';
import { TFile } from 'obsidian';
import fsAsync from "fs/promises"
import path from "path"


describe("resetVault", async () => {
    async function getAllFiles() {
        return await browser.executeObsidian(async ({app}) => {
            const result: Record<string, string> = {};
            for (const file of app.vault.getFiles()) {
                const content = await app.vault.read(file)
                result[file.path] = content.replace(/\r\n/g, '\n');
            }
            return result;
        })
    }

    async function getFileMtimes() {
        return await browser.executeObsidian(async ({app}) => {
            const result: Record<string, number> = {};
            for (const file of app.vault.getFiles()) {
                result[file.path] = file.stat.mtime;
            }
            return result;
        })
    }

    async function getAllFilesFromDisk() {
        const result: Record<string, string> = {};
        const vault = obsidianPage.getVaultPath();
        for (const file of await fsAsync.readdir(vault, {recursive: true, withFileTypes: true})) {
            if (file.isFile()) {
                const absPath = path.join(file.parentPath, file.name);
                const relPath = path.relative(vault, absPath).split(path.sep).join('/');
                const content = await fsAsync.readFile(absPath, 'utf-8');
                if (!relPath.startsWith(".obsidian")) {
                    result[relPath] = content.replace(/\r\n/g, '\n');
                }
            }
        }
        return result;
    }

    it("no change", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        const contentBefore = await getAllFiles();
        const mtimesBefore = await getFileMtimes();
        expect(Object.keys(contentBefore).sort()).toEqual(["Goodbye.md", "Welcome.md"]);
        await obsidianPage.resetVault();
        expect(await getAllFiles()).toEqual(contentBefore);
        expect(await getFileMtimes()).toEqual(mtimesBefore);
    })

    it("update file", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        const contentBefore = await getAllFiles();

        await browser.executeObsidian(async ({app}) => {
            await app.vault.modify(app.vault.getAbstractFileByPath("Welcome.md") as TFile, "changed");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles()).toEqual(contentBefore);
    })

    it("remove and create files", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        const contentBefore = await getAllFiles();

        await browser.executeObsidian(async ({app}) => {
            await app.vault.delete(app.vault.getAbstractFileByPath("Welcome.md") as TFile);
            await app.vault.create("New.md", "A new file");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles()).toEqual(contentBefore);
    })

    it("update file nested", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/nested"});
        const contentBefore = await getAllFiles();

        await browser.executeObsidian(async ({app}) => {
            await app.vault.modify(app.vault.getAbstractFileByPath("B/C.md") as TFile, "changed");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles()).toEqual(contentBefore);
    })

    it("remove and create files nested", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        const contentBefore = await getAllFiles();

        await browser.executeObsidian(async ({app}) => {
            await app.vault.delete(app.vault.getAbstractFileByPath("B/C.md") as TFile);
            await app.vault.create("New.md", "A new file");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles()).toEqual(contentBefore);
    })

    it("empty vault", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/empty"});
        await obsidianPage.resetVault();
        expect(await getAllFiles()).toEqual({});

        await browser.executeObsidian(async ({app}) => {
            await app.vault.create("New.md", "A new file");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles()).toEqual({});
    })

    it("new vault", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        await obsidianPage.resetVault("./test/vaults/nested");
        expect(await getAllFiles()).toEqual({
            'A.md': "File A\n",
            'B/C.md': "File C\n",
            'B/D/E.md': "File E\n",
        });
    })

    it("object", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/nested"});
        const vault = {
            "Leviathan Wakes.md": "2011",
            "Calibans War.md": "2012",
            "Abaddons Gate.md": "2013",
        }
        await obsidianPage.resetVault(vault);
        expect(await getAllFiles()).toEqual(vault);
    })

    it("merge", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        await obsidianPage.resetVault("./test/vaults/nested", {
            "B/C.md": "updated",
            "Z.md": "new",
        });
        expect(await getAllFiles()).toEqual({
            'A.md': "File A\n",
            'B/C.md': "updated",
            'B/D/E.md': "File E\n",
            "Z.md": "new",
        });
    })

    it("hidden files", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        await obsidianPage.resetVault("./test/vaults/nested", {
            ".file": "hidden file",
            ".folder/bar.md": "hidden folder",
        });
        expect(await getAllFilesFromDisk()).toEqual({
            'A.md': "File A\n",
            'B/C.md': "File C\n",
            'B/D/E.md': "File E\n",
            ".file": "hidden file",
            ".folder/bar.md": "hidden folder",
        });
        await obsidianPage.resetVault("./test/vaults/nested");
        expect(await getAllFilesFromDisk()).toEqual({
            'A.md': "File A\n",
            'B/C.md': "File C\n",
            'B/D/E.md': "File E\n",
        });
    })
})
