import { browser } from '@wdio/globals'
import { expect } from 'chai';
import path from 'path';
import fsAsync from "fs/promises"
import { TFile } from 'obsidian';


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

    it('enable/disable plugin', async () => {
        let plugins: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort() 
        );
        expect(plugins).to.eql(["basic-plugin", "wdio-obsidian-service-plugin"]);

        await browser.disablePlugin("basic-plugin");
        plugins = await browser.executeObsidian(({app}) => [...(app as any).plugins.enabledPlugins].sort());
        expect(plugins).to.eql(["wdio-obsidian-service-plugin"]);

        await browser.enablePlugin("basic-plugin");
        plugins = await browser.executeObsidian(({app}) => [...(app as any).plugins.enabledPlugins].sort());
        expect(plugins).to.eql(["basic-plugin", "wdio-obsidian-service-plugin"]);
    })

    it('set theme', async () => {
        let theme = await browser.executeObsidian(({app}) => (app.vault as any).getConfig("cssTheme"));
        expect(theme).to.eql("Basic Theme");
        
        await browser.setTheme("default");
        theme = await browser.executeObsidian(({app}) => (app.vault as any).getConfig("cssTheme"));
        expect(theme).to.eql("");

        await browser.setTheme("Basic Theme");
        theme = await browser.executeObsidian(({app}) => (app.vault as any).getConfig("cssTheme"));
        expect(theme).to.eql("Basic Theme");
    })

    it('windows', async () => {
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
