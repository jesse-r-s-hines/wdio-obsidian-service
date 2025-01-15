import { browser } from '@wdio/globals'
import { expect } from 'chai';
import * as path from "path"


describe("Basic obsidian launch", () => {
    before(async () => {
        await browser.openVault("./test/vaults/basic");
    })
    
    it('Obsidian version matches', async () => {
        const expectedAppVersion = browser.requestedCapabilities['wdio:obsidianOptions'].appVersion;
        expect(await browser.getObsidianVersion()).to.eql(expectedAppVersion);
        const actualAppVersion = await browser.execute("return electron.ipcRenderer.sendSync('version')");
        expect(actualAppVersion).to.eql(expectedAppVersion);

        const expectedInstallerVersion = browser.requestedCapabilities['wdio:obsidianOptions'].installerVersion;
        expect(await browser.getObsidianInstallerVersion()).to.eql(expectedInstallerVersion);
        const actualInstallerVersion = await browser.execute("return electron.remote.app.getVersion()");
        expect(actualInstallerVersion).to.eql(expectedInstallerVersion);
    })

    it('Vault opened', async () => {
        let vaultPath: string = await browser.execute('return app.vault.adapter.getBasePath()');
        vaultPath = path.normalize(vaultPath).replace("\\", "/");
        // Should have created a copy of vault
        expect(vaultPath).to.match(/^.*\/optl-.*\/vault$/);

        const vaultFiles = await browser.execute("return app.vault.getMarkdownFiles().map(x => x.path).sort()");
        expect(vaultFiles).to.eql(["Goodbye.md", "Welcome.md"]);
    })

    it('Sandboxed config', async () => {
        let configDir: string = await browser.execute("return electron.remote.app.getPath('userData')")
        configDir = path.normalize(configDir).replace("\\", "/");
        expect(configDir).to.match(/^.*\/optl-.*\/config$/);
    })

    it('plugin was installed and enabled', async () => {
        expect(await browser.$(".basic-plugin-status-bar-item").isExisting()).to.eql(true);
    })
})


describe("openVault", () => {
    it('openVault', async () => {
        const beforeVaultPath: string = await browser.execute('return app.vault.adapter.getBasePath()');
        const beforeConfigDir: string = await browser.execute("return electron.remote.app.getPath('userData')");

        await browser.openVault("./test/vaults/basic");

        const afterVaultPath: string = await browser.execute('return app.vault.adapter.getBasePath()');
        const afterConfigDir: string = await browser.execute("return electron.remote.app.getPath('userData')");
        const afterPlugins: string[] = await browser.execute("return [...app.plugins.enabledPlugins]");

        expect(beforeVaultPath).to.not.eql(afterVaultPath);
        expect(beforeConfigDir).to.not.eql(afterConfigDir);
        expect(afterPlugins).to.eql(["basic-plugin"]);

        await browser.openVault("./test/vaults/basic", []);
        const noPlugins: string[] = await browser.execute("return [...app.plugins.enabledPlugins]");
        expect(noPlugins).to.eql([]);
    })
})
