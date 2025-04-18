import { browser } from '@wdio/globals'
import { TFile } from 'obsidian';
import semver from "semver";
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
    })

    it('runObsidianCommand', async () => {
        expect(await browser.execute("return window.doTheThingCalled ?? 0")).toEqual(0);
        await browser.executeObsidianCommand("basic-plugin:do-the-thing");
        expect(await browser.execute("return window.doTheThingCalled")).toEqual(1);
    })

    it("getObsidianPage", async () => {
        const commandObsidianPage = await browser.getObsidianPage();
        expect(commandObsidianPage).toBe(obsidianPage);
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
        expect(response).toEqual(true);

        await browser.switchToWindow(mainWindow);
        await browser.executeObsidian(({app}) => { app.workspace.detachLeavesOfType("markdown") })
    })
})
