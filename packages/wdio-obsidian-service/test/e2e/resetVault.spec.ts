import { browser } from '@wdio/globals'
import { expect } from 'chai';
import obsidianPage from '../../src/pageobjects/obsidianPage.js';
import { TFile } from 'obsidian';


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

    it("no change", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        const contentBefore = await getAllFiles();
        expect(Object.keys(contentBefore).sort()).to.eql(["Goodbye.md", "Welcome.md"]);
        await obsidianPage.resetVault();
        expect(await getAllFiles()).to.eql(contentBefore);
    })

    it("update file", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        const contentBefore = await getAllFiles();

        await browser.executeObsidian(async ({app}) => {
            await app.vault.modify(app.vault.getAbstractFileByPath("Welcome.md") as TFile, "changed");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles()).to.eql(contentBefore);
    })

    it("remove and create files", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        const contentBefore = await getAllFiles();

        await browser.executeObsidian(async ({app}) => {
            await app.vault.delete(app.vault.getAbstractFileByPath("Welcome.md") as TFile);
            await app.vault.create("New.md", "A new file");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles()).to.eql(contentBefore);
    })

    it("update file nested", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/nested"});
        const contentBefore = await getAllFiles();

        await browser.executeObsidian(async ({app}) => {
            await app.vault.modify(app.vault.getAbstractFileByPath("B/C.md") as TFile, "changed");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles()).to.eql(contentBefore);
    })

    it("remove and create files nested", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        const contentBefore = await getAllFiles();

        await browser.executeObsidian(async ({app}) => {
            await app.vault.delete(app.vault.getAbstractFileByPath("B/C.md") as TFile);
            await app.vault.create("New.md", "A new file");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles()).to.eql(contentBefore);
    })

    it("empty vault", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/empty"});
        await obsidianPage.resetVault();
        expect(await getAllFiles()).to.eql({});

        await browser.executeObsidian(async ({app}) => {
            await app.vault.create("New.md", "A new file");
        })

        await obsidianPage.resetVault();
        expect(await getAllFiles()).to.eql({});
    })

    it("new vault", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        await obsidianPage.resetVault("./test/vaults/nested");
        expect(await getAllFiles()).to.eql({
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
        expect(await getAllFiles()).to.eql(vault);
    })

    it("merge", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        await obsidianPage.resetVault("./test/vaults/nested", {
            "B/C.md": "updated",
            "Z.md": "new",
        });
        expect(await getAllFiles()).to.eql({
            'A.md': "File A\n",
            'B/C.md': "updated",
            'B/D/E.md': "File E\n",
            "Z.md": "new",
        });
    })
})
