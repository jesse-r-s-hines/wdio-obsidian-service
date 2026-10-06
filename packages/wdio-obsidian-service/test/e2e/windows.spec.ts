import { browser, expect } from '@wdio/globals'
import { obsidianPage } from 'wdio-obsidian-service';
import semver from "semver"
import { TFile } from 'obsidian';

async function testExecuteObsidian() {
    // ensure the arg has valid values
    const isAvailable = await browser.executeObsidian((obj) => !!(obj?.app?.workspace && obj?.obsidian.App));
    expect(isAvailable).toEqual(true);

    // ensure its running in the same window as execute
    const currentWindowId = await browser.execute(() => (window as any).electron.remote.getCurrentWindow().id);
    const actualId = await browser.executeObsidian(() => (window as any).electron.remote.getCurrentWindow().id);
    expect(currentWindowId).toEqual(actualId);
}

async function getWindowHandles() {
    const currentWindow = await browser.getWindowHandle();
    const windows = await browser.getWindowHandles();
    return [currentWindow, ...windows.filter(h => h != currentWindow)];
}

async function openPluginBrowser() {
    await browser.executeObsidianCommand("app:open-settings");
    const [mainWindow, settingsWindow] = await getWindowHandles();
    await browser.switchToWindow(settingsWindow);
    await browser.$('[data-setting-id="community-plugins"]').click();
    await browser.$('button=Browse').click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length == 3);
    const pluginBrowser = (await browser.getWindowHandles()).find(h => ![mainWindow, settingsWindow].includes(h))!;
    await browser.switchToWindow(pluginBrowser);
}

describe("Test windows no vault open", () => {
    it("getMainWindowHandle basic", async function() {
        const mainWindow1 = await obsidianPage.getMainWindowHandle();
        expect(await browser.getWindowHandles()).toEqual([mainWindow1]);
    })
})

describe("Test windows", () => {
    before(async function() {
        const installerVersion = browser.getObsidianInstallerVersion();
        if (semver.lt(installerVersion, "0.12.19") || (await obsidianPage.getPlatform()).isMobile) {
            this.skip(); // Windows don't work on older installer versions or mobile
        }
    })

    beforeEach(async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
    })

    it('executeObsidian basic windows', async function() {
        await browser.executeObsidian(async ({app}) => {
            await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath("Welcome.md") as TFile);
            await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath("Goodbye.md") as TFile);
        })
        await browser.executeObsidianCommand("workspace:move-to-new-window");
        let [mainWindow, otherWindow] = await getWindowHandles();

        await browser.switchToWindow(otherWindow);
        await testExecuteObsidian()

        await browser.switchToWindow(mainWindow);
        await testExecuteObsidian()

        // test with windows opened at launch
        await browser.reloadObsidian();
        expect((await browser.getWindowHandles()).length).toEqual(2);
        expect([mainWindow, otherWindow]).not.toContain(await browser.getWindowHandle());

        [mainWindow, otherWindow] = await getWindowHandles();
        await testExecuteObsidian()

        await browser.switchToWindow(mainWindow);
        await testExecuteObsidian()
    })

    it('executeObsidian settings panel', async function() {
        // settings panel popout window was introduced in 1.13.0
        if (semver.lt(browser.getObsidianVersion(), "1.13.0")) this.skip();
        await browser.executeObsidianCommand("app:open-settings");
        const [mainWindow, settingsWindow] = await getWindowHandles();
        await testExecuteObsidian();
        await browser.switchToWindow(settingsWindow);
        await testExecuteObsidian();
    })

    it('executeObsidian plugin browser', async function() {
        if (semver.lt(browser.getObsidianVersion(), "1.13.0")) this.skip();
        await openPluginBrowser();
        await testExecuteObsidian();
    })

    it("getMainWindowHandle basic", async function() {
        const mainWindow1 = await obsidianPage.getMainWindowHandle();
        expect(await browser.getWindowHandles()).toEqual([mainWindow1]);
        await browser.executeObsidian(async ({app}) => {
            await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath("Welcome.md") as TFile);
            await app.workspace.getLeaf('tab').openFile(app.vault.getAbstractFileByPath("Goodbye.md") as TFile);
        })
        await browser.executeObsidianCommand("workspace:move-to-new-window");

        const [mainWindow, otherWindow] = await getWindowHandles();
        expect(mainWindow).toEqual(mainWindow1);
        expect(await obsidianPage.getMainWindowHandle()).toEqual(mainWindow1);

        // reload will change window, make sure the cached mainWindow is updated
        await browser.switchToWindow(mainWindow);
        await browser.reloadObsidian();

        expect((await browser.getWindowHandles()).length).toEqual(2);
        expect(await obsidianPage.getMainWindowHandle()).not.toEqual(mainWindow1);
        expect(await obsidianPage.getMainWindowHandle()).toEqual(await browser.getWindowHandle());
    })

    it("getMainWindowHandle settings", async function() {
        if (semver.lt(browser.getObsidianVersion(), "1.13.0")) this.skip();
        const mainWindow = await browser.getWindowHandle();
        await browser.executeObsidianCommand("app:open-settings");
        expect(await obsidianPage.getMainWindowHandle()).toEqual(mainWindow);
    })

    it("getMainWindowHandle plugin browser", async function() {
        if (semver.lt(browser.getObsidianVersion(), "1.13.0")) this.skip();
        const mainWindow = await browser.getWindowHandle();
        await openPluginBrowser();
        expect(await obsidianPage.getMainWindowHandle()).toEqual(mainWindow);
    })
})

