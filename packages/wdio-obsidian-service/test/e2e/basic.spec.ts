import { browser, expect } from '@wdio/globals'
import path from "path"
import { OBSIDIAN_CAPABILITY_KEY } from '../../src/types.js';


describe("Basic obsidian launch", () => {
    before(async () => {
        // Obsidian should start with no vault open
        expect(browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].vault).toEqual(undefined);
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
    })
    
    it('Obsidian version matches', async () => {
        const expectedAppVersion = browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].appVersion;
        expect(browser.getObsidianVersion()).toEqual(expectedAppVersion);
        const actualAppVersion = await browser.execute("return electron.ipcRenderer.sendSync('version')");
        expect(actualAppVersion).toEqual(expectedAppVersion);

        const expectedInstallerVersion = browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].installerVersion;
        expect(browser.getObsidianInstallerVersion()).toEqual(expectedInstallerVersion);
        const actualInstallerVersion = await browser.execute("return electron.remote.app.getVersion()");
        expect(actualInstallerVersion).toEqual(expectedInstallerVersion);
    })

    it('Vault opened', async () => {
        const vaultPath = await browser.executeObsidian(({app}) => (app.vault.adapter as any).getBasePath());

        // Should have created a copy of vault
        expect(path.basename(vaultPath)).toMatch(/^basic-/)

        const vaultFiles = await browser.executeObsidian(({app}) =>
            app.vault.getMarkdownFiles().map(x => x.path).sort()
        );
        expect(vaultFiles).toEqual(["Goodbye.md", "Welcome.md"]);
    })

    it('Sandboxed config', async () => {
        const configDir: string = await browser.execute("return electron.remote.app.getPath('userData')")
        // Should be using sandboxed config dir
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
