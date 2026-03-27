import { browser, expect } from '@wdio/globals'
import path from "path";
import { obsidianPage } from 'wdio-obsidian-service';


describe("obsidian no copy", function() {
    it('getVaultPath desktop', async function() {
        if ((await obsidianPage.getPlatform()).isMobileApp) this.skip();

        const pageVault = obsidianPage.getVaultPath();
        const obsVault = await browser.executeObsidian(({app}) => (app.vault.adapter as any).getFullPath(""));
        const capVault = browser.requestedCapabilities['wdio:obsidianOptions'].vault;
        
        expect(pageVault).toEqual(capVault);
        expect(obsVault).toEqual(capVault)
    })

    it('getVaultPath android', async function() {
        if ((await obsidianPage.getPlatform()).isDesktopApp) this.skip();

        const pageVault = obsidianPage.getVaultPath();
        let obsVault = await browser.executeObsidian(({app}) => (app.vault.adapter as any).getFullPath(""));
        obsVault = obsVault.replace(/\/$/, '') // on android getFullPath returns a trailing slash
        const capAndroidVault = browser.requestedCapabilities['wdio:obsidianOptions'].androidVault;

        expect(pageVault).toEqual(obsVault);
        expect(capAndroidVault).toMatch(/-nocopy/);
    })

    it("reload", async function() {
        // On android capVault is host path and noCopyVault is android path. On desktop they'll be the same.
        const capVault = browser.requestedCapabilities['wdio:obsidianOptions'].vault;
        const noCopyVault = obsidianPage.getVaultPath();

        await obsidianPage.write("New.md", "NEW FILE");

        // test switching to a different vault, it should work and still copy by default
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        expect(obsidianPage.getVaultPath()).not.toEqual(noCopyVault);
        expect(path.basename(obsidianPage.getVaultPath())).toMatch(/basic-\w+/)

        // test switching back with copy false, it should switch to the same vault
        await browser.reloadObsidian({vault: capVault, copy: false});
        expect(obsidianPage.getVaultPath()).toEqual(noCopyVault);
        expect(await obsidianPage.read("New.md")).toEqual("NEW FILE");

        // test inplace reload still works and ignores copy param
        await browser.reloadObsidian({});
        expect(obsidianPage.getVaultPath()).toEqual(noCopyVault);
        await browser.reloadObsidian({copy: true});
        expect(obsidianPage.getVaultPath()).toEqual(noCopyVault);
    })
})
