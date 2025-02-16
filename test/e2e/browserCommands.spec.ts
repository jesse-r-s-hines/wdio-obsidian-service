import { browser } from '@wdio/globals'
import { expect } from 'chai';
import path from 'path';

describe("Test custom browser commands", () => {
    before(async () => {
        await browser.openVault("./test/vaults/basic");
    })

    it('getVaultPath', async () => {
        const vaultPath = await browser.getVaultPath();
        expect(vaultPath).to.eql(path.resolve("./test/vaults/basic"));
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
        expect(plugins).to.eql(["basic-plugin", "optl-plugin"]);

        await browser.disablePlugin("basic-plugin");
        plugins = await browser.executeObsidian(({app}) => [...(app as any).plugins.enabledPlugins].sort());
        expect(plugins).to.eql(["optl-plugin"]);

        await browser.enablePlugin("basic-plugin");
        plugins = await browser.executeObsidian(({app}) => [...(app as any).plugins.enabledPlugins].sort());
        expect(plugins).to.eql(["basic-plugin", "optl-plugin"]);
    })
})
