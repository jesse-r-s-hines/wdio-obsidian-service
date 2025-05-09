import { browser } from '@wdio/globals'
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
        expect(configDir).toContain("obs-launcher-config-");
    })

    it('plugin was installed and enabled', async () => {
        await expect(browser.$(".basic-plugin-status-bar-item")).toExist();
    })

    it('theme was installed and enabled', async () => {
        const enabledTheme = await browser.execute("return app.customCss.theme");
        expect(enabledTheme).toEqual("Basic Theme")
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

        expect(vaultPath2).not.toEqual(vaultPath1);
        expect(configDir2).not.toEqual(configDir1);
        expect(plugins2).toEqual(["basic-plugin", "wdio-obsidian-service-plugin"]);
        expect(theme2).toEqual("Basic Theme");
        // Should have re-copied the vault (not carrying foo.md over)
        expect(files2).toEqual(["Goodbye.md", "Welcome.md"]);

        await browser.executeObsidian(async ({app}) => {
            await app.vault.create("foo.md", "FOO");
        })
        // Test preserving the vault.
        await browser.reloadObsidian();

        const vaultPath3: string = await browser.executeObsidian(({app}) =>
            (app.vault.adapter as any).getBasePath()
        );
        const configDir3: string = await browser.execute("return electron.remote.app.getPath('userData')");
        const plugins3: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort()
        );
        const theme3 = await browser.execute("return app.customCss.theme");
        const files3 = await browser.executeObsidian(({app}) =>
            app.vault.getMarkdownFiles().map(f => f.path).sort()
        );

        expect(vaultPath3).toEqual(vaultPath2);
        expect(configDir3).toEqual(configDir2);
        expect(plugins3).toEqual(plugins2);
        expect(theme3).toEqual(theme2);
        expect(files3).toEqual(["Goodbye.md", "Welcome.md", "foo.md"]);

        // Test no plugins, no theme, and a new vault
        await browser.reloadObsidian({vault: "./test/vaults/basic2", plugins: [], theme: "default"});
        const plugins4: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort()
        );
        const theme4 = await browser.executeObsidian(({app}) => (app as any).customCss.theme);
        const files4 = await browser.executeObsidian(({app}) =>
            app.vault.getMarkdownFiles().map(f => f.path).sort()
        );
        expect(plugins4).toEqual(["wdio-obsidian-service-plugin"]);
        expect(!!theme4).toEqual(false);
        expect(files4).toEqual(["A.md", "B.md"]);

        // Test enabling a plugin via reloadObsidian
        await browser.reloadObsidian({vault: "./test/vaults/basic", plugins: ["basic-plugin"], theme: "Basic Theme"});
        const plugins5: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort()
        );
        const theme5 = await browser.executeObsidian(({app}) => (app as any).customCss.theme);

        expect(plugins5).toEqual(["basic-plugin", "wdio-obsidian-service-plugin"]);
        expect(theme5).toEqual("Basic Theme");

        // Test changing plugins without resetting vault
        await browser.reloadObsidian({plugins: [], theme: "default"});
        const plugins6: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort()
        );
        const theme6 = await browser.execute("return app.customCss.theme");

        expect(plugins6).toEqual(['wdio-obsidian-service-plugin']);
        expect(theme6).toEqual("");
    })
})
