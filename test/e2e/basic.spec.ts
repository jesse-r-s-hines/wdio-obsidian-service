import { browser } from '@wdio/globals'
import { expect } from 'chai';
import path from "path"
import os from "os"
import { OBSIDIAN_CAPABILITY_KEY } from '../../src/types.js';


describe("Basic obsidian launch", () => {
    before(async () => {
        // Obsidian should start with no vault open
        expect(await browser.getVaultPath()).to.eql(undefined);
        await browser.openVault({vault: "./test/vaults/basic"});
    })
    
    it('Obsidian version matches', async () => {
        const expectedAppVersion = browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].appVersion;
        expect(await browser.getObsidianVersion()).to.eql(expectedAppVersion);
        const actualAppVersion = await browser.execute("return electron.ipcRenderer.sendSync('version')");
        expect(actualAppVersion).to.eql(expectedAppVersion);

        const expectedInstallerVersion = browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].installerVersion;
        expect(await browser.getObsidianInstallerVersion()).to.eql(expectedInstallerVersion);
        const actualInstallerVersion = await browser.execute("return electron.remote.app.getVersion()");
        expect(actualInstallerVersion).to.eql(expectedInstallerVersion);
    })

    it('Vault opened', async () => {
        let vaultPath: string = await browser.executeObsidian(({app}) => (app.vault.adapter as any).getBasePath());
        // Should have created a copy of vault
        expect(vaultPath).to.contain("obs-launcher-vault-");

        const vaultFiles = await browser.executeObsidian(({app}) =>
            app.vault.getMarkdownFiles().map(x => x.path).sort()
        );
        expect(vaultFiles).to.eql(["Goodbye.md", "Welcome.md"]);
    })

    it('Sandboxed config', async () => {
        const configDir: string = await browser.execute("return electron.remote.app.getPath('userData')")
        // Should be using sandboxed config dir
        expect(configDir).to.contain("obs-launcher-config-");
    })

    it('plugin was installed and enabled', async () => {
        expect(await browser.$(".basic-plugin-status-bar-item").isExisting()).to.equal(true);
    })

    it('theme was installed and enabled', async () => {
        const enabledTheme = await browser.execute("return app.customCss.theme");
        expect(enabledTheme).to.eql("Basic Theme")
    })

    it('openVault', async () => {
        const beforeVaultPath: string = await browser.executeObsidian(({app}) =>
            (app.vault.adapter as any).getBasePath()
        );
        const beforeConfigDir: string = await browser.execute("return electron.remote.app.getPath('userData')");

        // This should re-open the same vault with the same plugins and themes
        await browser.openVault({vault: "./test/vaults/basic"});

        const afterVaultPath: string = await browser.executeObsidian(({app}) =>
            (app.vault.adapter as any).getBasePath()
        );
        const afterConfigDir: string = await browser.execute("return electron.remote.app.getPath('userData')");
        const afterPlugins: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort()
        );
        const afterTheme = await browser.execute("return app.customCss.theme");

        expect(beforeVaultPath).to.not.eql(afterVaultPath);
        expect(beforeConfigDir).to.not.eql(afterConfigDir);
        expect(afterPlugins).to.eql(["basic-plugin", "wdio-obsidian-service-plugin"]);
        expect(afterTheme).to.eql("Basic Theme");

        // Test no plugins, no theme, and a new vault
        await browser.openVault({vault: "./test/vaults/basic2", plugins: [], theme: "default"});
        const noPlugins: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort()
        );
        const noTheme = await browser.executeObsidian(({app}) => (app as any).customCss.theme);
        const vaultFiles = await browser.executeObsidian(({app}) =>
            app.vault.getMarkdownFiles().map(x => x.path).sort()
        );
        expect(noPlugins).to.eql(["wdio-obsidian-service-plugin"]);
        expect(!!noTheme).to.eql(false);
        expect(vaultFiles).to.eql(["A.md", "B.md"]);

        // Test installing the plugin via openVault
        await browser.openVault({vault: "./test/vaults/basic", plugins: ["basic-plugin"], theme: "Basic Theme"});
        const afterPlugins2: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort()
        );
        const afterTheme2 = await browser.executeObsidian(({app}) => (app as any).customCss.theme);

        expect(afterPlugins2).to.eql(["basic-plugin", "wdio-obsidian-service-plugin"]);
        expect(afterTheme2).to.eql("Basic Theme");
    })
})
