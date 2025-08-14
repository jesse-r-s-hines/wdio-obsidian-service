import { browser, expect } from '@wdio/globals'
import { obsidianPage } from 'wdio-obsidian-service';
import { TFile } from 'obsidian';
import { getAllFiles } from '../helpers.js';
import { OBSIDIAN_CAPABILITY_KEY } from '../../src/types.js';

describe("resetVault1", function() {
    it("no vault open", async () => {
        expect(browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].vault).toEqual(undefined);
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
})
