import { browser } from '@wdio/globals'
import { expect } from 'chai';
import path from 'path';
import fsAsync from "fs/promises"
import { TFile } from 'obsidian';
import semver from "semver";
import { ObsidianPage } from '../../src/pageobjects/obsidianPage.js';


describe("Test custom browser commands", () => {
    before(async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
    })

    it('getVaultPath', async () => {
        const originalVaultPath = path.resolve("./test/vaults/basic");
        const vaultPath = (await browser.getVaultPath())!;
        
        // vault should be copied
        expect(path.resolve(vaultPath)).to.not.eql(originalVaultPath)
        expect(await fsAsync.readdir(vaultPath)).to.include.members(["Goodbye.md", "Welcome.md"]);
    })
    
    it('runObsidianCommand', async () => {
        expect(await browser.execute("return window.doTheThingCalled ?? 0")).to.eql(0);
        await browser.executeObsidianCommand("basic-plugin:do-the-thing");
        expect(await browser.execute("return window.doTheThingCalled")).to.eql(1);
    })

    it("getObsidianPage", async () => {
        const obsidianPage = await browser.getObsidianPage();
        expect(obsidianPage).to.be.instanceof(ObsidianPage);
    })
})

describe("Test windows", () => {
    before(async function() {
        if (semver.lt(await browser.getObsidianInstallerVersion(), "0.12.19")) {
            // Windows don't work on older installer versions
            this.skip()
        }
    })

    it('windows', async function() {
        // pop-out windows have isolated window objects, check that executeObsidian still works and can access the
        // globals.
        await browser.executeObsidian(async ({app}) => {
            await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath("Welcome.md") as TFile);
            await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath("Goodbye.md") as TFile);
        })
        await browser.executeObsidianCommand("workspace:move-to-new-window");
        const mainWindow = await browser.getWindowHandle();
        const otherWindow = (await browser.getWindowHandles()).find(h => h != mainWindow)!;
        await browser.switchToWindow(otherWindow);

        const response = await browser.executeObsidian((obj) => {
            return !!(
                obj?.app &&
                obj?.app?.workspace &&
                obj?.obsidian &&
                obj?.obsidian.App
            )
        })
        expect(response).to.eql(true);

        await browser.switchToWindow(mainWindow);
        await browser.executeObsidian(({app}) => { app.workspace.detachLeavesOfType("markdown") })
    })
})
