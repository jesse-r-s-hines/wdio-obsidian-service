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
})
