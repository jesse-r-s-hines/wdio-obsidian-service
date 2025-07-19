import { browser, expect } from '@wdio/globals'
import { obsidianPage } from 'wdio-obsidian-service';


describe("Emulate Mobile", () => {
    before(async function() {
        const platform = await obsidianPage.getPlatform();
        if (!platform.isMobile || platform.isMobileApp) this.skip();
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
    })

    it('Platform', async function() {
        const isMobile = await browser.executeObsidian(({obsidian}) => obsidian.Platform.isMobile);
        const isPhone = await browser.executeObsidian(({obsidian}) => obsidian.Platform.isMobile);
        expect(isMobile).toEqual(true);
        expect(isPhone).toEqual(true);

        const platform = await obsidianPage.getPlatform();
        expect(platform.isMobile).toEqual(true);
        expect(platform.isMobileApp).toEqual(false);
        expect(platform.isPhone).toEqual(true);
    })

    it('window size', async function() {
        const [width, height] = await browser.executeObsidian(() => {
            return [window.innerWidth, window.innerHeight];
        })
        expect([width, height]).toEqual([390, 844]);
    })
})
