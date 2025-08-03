import { browser, expect } from '@wdio/globals'
import path from "path";
import { OBSIDIAN_CAPABILITY_KEY } from '../../src/types.js';
import { obsidianPage } from 'wdio-obsidian-service';


describe("Basic obsidian launch", function() {
    it('Obsidian version matches', async function() {
        const expectedAppVersion = browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].appVersion;
        expect(browser.getObsidianVersion()).toEqual(expectedAppVersion);
        const actualAppVersion = await browser.executeObsidian(({obsidian}) => obsidian.apiVersion);
        expect(actualAppVersion).toEqual(expectedAppVersion);

        if ((await obsidianPage.getPlatform()).isDesktopApp) { // will be true even under emulateMobile
            const expectedInstallerVersion = browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].installerVersion;
            expect(browser.getObsidianInstallerVersion()).toEqual(expectedInstallerVersion);
            const actualInstallerVersion = await browser.execute("return electron.remote.app.getVersion()");
            expect(actualInstallerVersion).toEqual(expectedInstallerVersion);
        } else {
            expect(browser.getObsidianInstallerVersion()).toEqual(expectedAppVersion);
        }
    })

    it('Vault opened', async function() {
        const vaultPath = await browser.executeObsidian(({app}) => (app.vault.adapter as any).getFullPath(""));

        // Should have created a copy of vault
        expect(path.basename(vaultPath)).toMatch(/^basic-/)

        const vaultFiles = await browser.executeObsidian(({app}) =>
            app.vault.getMarkdownFiles().map(x => x.path).sort()
        );
        expect(vaultFiles).toEqual(["Goodbye.md", "Welcome.md"]);
    })

    it('Sandboxed config', async function() {
        if ((await obsidianPage.getPlatform()).isMobileApp) this.skip();
        const configDir: string = await browser.execute("return electron.remote.app.getPath('userData')")
        expect(configDir).toContain("obsidian-launcher-config-");
    })

    it('plugin was installed and enabled', async () => {
        await expect(browser.$(".basic-plugin-status-bar-item")).toExist();
    })

    it('theme was installed and enabled', async () => {
        const enabledTheme = await browser.execute("return app.customCss.theme");
        expect(enabledTheme).toEqual("Basic Theme")
    })
})
