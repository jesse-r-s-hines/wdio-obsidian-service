import { browser } from '@wdio/globals'
import { expect } from 'chai';
import { OBSIDIAN_CAPABILITY_KEY } from '../../src/types.js';


describe("Basic obsidian launch", () => {
    before(async () => {
        // Obsidian should start with no vault open
        expect(await browser.getVaultPath()).to.eql(undefined);
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
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
        const vaultPath = await browser.executeObsidian(({app}) => (app.vault.adapter as any).getBasePath());
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

    it('reloadObsidian', async () => {
        const vaultPath1: string = await browser.executeObsidian(({app}) =>
            (app.vault.adapter as any).getBasePath()
        );
        const configDir1: string = await browser.execute("return electron.remote.app.getPath('userData')");

        await browser.executeObsidian(async ({app}) => {
            await app.vault.create("foo.md", "FOO");
        })

        // This should re-open the same vault with the same plugins and themes, and re-copying the vault from source
        await browser.reloadObsidian({vault: "./test/vaults/basic"});

        const vaultPath2: string = await browser.executeObsidian(({app}) =>
            (app.vault.adapter as any).getBasePath()
        );
        const configDir2: string = await browser.execute("return electron.remote.app.getPath('userData')");
        const plugins2: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort()
        );
        const theme2 = await browser.execute("return app.customCss.theme");
        const files2 = await browser.executeObsidian(({app}) =>
            app.vault.getMarkdownFiles().map(f => f.path).sort()
        );

        expect(vaultPath2).to.not.eql(vaultPath1);
        expect(configDir2).to.not.eql(configDir1);
        expect(plugins2).to.eql(["basic-plugin", "wdio-obsidian-service-plugin"]);
        expect(theme2).to.eql("Basic Theme");
        // Should have re-copied the vault (not carrying foo.md over)
        expect(files2).to.eql(["Goodbye.md", "Welcome.md"]);

        await browser.executeObsidian(async ({app}) => {
            await app.vault.create("foo.md", "FOO");
        })
        // Test preserving the vault.
        await browser.reloadObsidian();

        const vaultPath3: string = await browser.executeObsidian(({app}) =>
            (app.vault.adapter as any).getBasePath()
        );
        const configDir3: string = await browser.execute("return electron.remote.app.getPath('userData')");
        const files3 = await browser.executeObsidian(({app}) =>
            app.vault.getMarkdownFiles().map(f => f.path).sort()
        );

        expect(vaultPath3).to.eql(vaultPath2);
        expect(configDir3).to.eql(configDir2);
        expect(files3).to.eql(["Goodbye.md", "Welcome.md", "foo.md"]);

        // Test no plugins, no theme, and a new vault
        await browser.reloadObsidian({vault: "./test/vaults/basic2", plugins: [], theme: "default"});
        const plugins4: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort()
        );
        const theme4 = await browser.executeObsidian(({app}) => (app as any).customCss.theme);
        const files4 = await browser.executeObsidian(({app}) =>
            app.vault.getMarkdownFiles().map(f => f.path).sort()
        );
        expect(plugins4).to.eql(["wdio-obsidian-service-plugin"]);
        expect(!!theme4).to.eql(false);
        expect(files4).to.eql(["A.md", "B.md"]);

        // Test installing a plugin via reloadObsidian
        await browser.reloadObsidian({vault: "./test/vaults/basic", plugins: ["basic-plugin"], theme: "Basic Theme"});
        const plugins5: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort()
        );
        const theme5 = await browser.executeObsidian(({app}) => (app as any).customCss.theme);

        expect(plugins5).to.eql(["basic-plugin", "wdio-obsidian-service-plugin"]);
        expect(theme5).to.eql("Basic Theme");
    })
})
