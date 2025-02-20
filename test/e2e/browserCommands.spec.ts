import { browser } from '@wdio/globals'
import { expect } from 'chai';
import path from 'path';
import fsAsync from "fs/promises"

describe("Test custom browser commands", () => {
    before(async () => {
        await browser.openVault("./test/vaults/basic");
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
})
