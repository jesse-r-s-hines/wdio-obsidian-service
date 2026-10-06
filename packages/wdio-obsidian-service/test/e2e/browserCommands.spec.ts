import { browser, expect } from '@wdio/globals'
import { obsidianPage } from 'wdio-obsidian-service';


describe("Test custom browser commands", () => {
    before(async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
    })

    it("executeObsidian", async () => {
        const result = await browser.executeObsidian((arg) => {
            return Object.keys(arg).sort();
        });
        expect(result).toEqual(['app', 'obsidian', 'plugins', 'require']);
        const plugins = await browser.executeObsidian(({obsidian, plugins}) => {
            return Object.fromEntries(Object.entries(plugins)
                .map(([k, v]) => [k, v instanceof obsidian.Plugin])
            );
        });
        expect(plugins).toEqual({
            basicPlugin: true,
        })

        await browser.executeObsidian(() => {
            require('obsidian'); // test that require global is set up
        });
    })

    it('runObsidianCommand', async () => {
        expect(await browser.execute("return window.doTheThingCalled ?? 0")).toEqual(0);
        await browser.executeObsidianCommand("basic-plugin:do-the-thing");
        expect(await browser.execute("return window.doTheThingCalled")).toEqual(1);
    })

    it("getObsidianPage", async () => {
        const commandObsidianPage = browser.getObsidianPage();
        expect(commandObsidianPage).toBeInstanceOf(obsidianPage.constructor);
    })
})
