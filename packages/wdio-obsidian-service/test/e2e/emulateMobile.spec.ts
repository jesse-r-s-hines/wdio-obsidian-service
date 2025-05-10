import { browser } from '@wdio/globals'
import { OBSIDIAN_CAPABILITY_KEY } from '../../src/types.js';


describe("Emulate Mobile", () => {
    before(async function() {
        // Obsidian should start with no vault open
        if (!browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].emulateMobile) {
            this.skip();
        }
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
    })
    
    it('Platform isMobile', async function() {
        const isMobile = await browser.executeObsidian(({obsidian}) => obsidian.Platform.isMobile);
        expect(isMobile).toEqual(true);
    })

    it('window size', async function() {
        const [width, height] = await browser.executeObsidian(({}) => {
            return [window.innerWidth, window.innerHeight];
        })
        expect([width, height]).toEqual([412, 914]);
    })
})
