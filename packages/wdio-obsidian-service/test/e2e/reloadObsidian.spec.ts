import { browser, expect } from '@wdio/globals'
import { OBSIDIAN_CAPABILITY_KEY } from '../../src/types.js';

describe("reloadObsidian", () => {
    before(async () => {
        // Obsidian should start with no vault open
        expect(browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].vault).toEqual(undefined);
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
    })

    // Used to test that local storage and the config dir does or does not get cleared.
    async function getLocalStorage() {
        return await browser.execute(async () => {
            const data: any = {}
            for (let i = 0, len = localStorage.length; i < len; ++i ) {
                const key = localStorage.key(i)!;
                const value = localStorage.getItem(key);
                data[key] = value;
            }
            return data;
        });
    }

    async function setLocalStorage(data: Record<string, string>) {
        await browser.execute(async (data) => {
            for (const [key, value] of Object.entries(data)) {
                localStorage.setItem(key, value);
            }
        }, data)
    }

    async function getVaultPath(): Promise<string> {
        return await browser.executeObsidian(({app}) => (app.vault.adapter as any).getFullPath(""));
    }

    async function getPlugins(): Promise<string[]> {
        return await browser.executeObsidian(({app}) => [...(app as any).plugins.enabledPlugins].sort());
    }

    it('reloadObsidian', async () => {
        const vaultPath1 = await getVaultPath();
        await browser.executeObsidian(async ({app}) => {
            await app.vault.create("foo.md", "FOO");
        })
        await setLocalStorage({"foo": "bar"});
        const localStorage1 = await getLocalStorage();
        const plugins1 = await getPlugins();
        expect(localStorage1).toMatchObject({"foo": "bar"});
        expect(plugins1).toEqual(["basic-plugin", "wdio-obsidian-service-plugin"]);

        // This should re-open the same vault with the same plugins and themes, re-copying the vault from source and
        // resetting the config dir.
        await browser.reloadObsidian({vault: "./test/vaults/basic"});

        const vaultPath2 = await getVaultPath();
        const localStorage2 = await getLocalStorage();
        const plugins2: string[] = await getPlugins();
        const theme2 = await browser.execute("return app.customCss.theme");
        const files2 = await browser.executeObsidian(({app}) =>
            app.vault.getMarkdownFiles().map(f => f.path).sort()
        );

        expect(vaultPath2).not.toEqual(vaultPath1);
        expect(localStorage2).not.toMatchObject({"foo": "bar"});
        expect(plugins2).toEqual(["basic-plugin", "wdio-obsidian-service-plugin"]);
        expect(theme2).toEqual("Basic Theme");
        expect(files2).toEqual(["Goodbye.md", "Welcome.md"]);


        // Test preserving the vault and config
        await browser.executeObsidian(async ({app}) => {
            await app.vault.create("foo.md", "FOO");
        });
        await setLocalStorage({"my-key": "my-value"});
        await browser.reloadObsidian();

        const vaultPath3 = await getVaultPath();
        const localStorage3 = await getLocalStorage();
        const plugins3: string[] = await getPlugins();
        const theme3 = await browser.execute("return app.customCss.theme");
        const files3 = await browser.executeObsidian(({app}) =>
            app.vault.getMarkdownFiles().map(f => f.path).sort()
        );

        expect(vaultPath3).toEqual(vaultPath2);
        expect(localStorage3).toMatchObject({"my-key": "my-value"});
        expect(plugins3).toEqual(plugins2);
        expect(theme3).toEqual(theme2);
        expect(files3).toEqual(["Goodbye.md", "Welcome.md", "foo.md"]);

        // Test no plugins, no theme, and a new vault
        await browser.reloadObsidian({vault: "./test/vaults/basic2", plugins: [], theme: "default"});
        const plugins4: string[] = await getPlugins();
        const theme4 = await browser.executeObsidian(({app}) => (app as any).customCss.theme);
        const files4 = await browser.executeObsidian(({app}) =>
            app.vault.getMarkdownFiles().map(f => f.path).sort()
        );
        expect(plugins4).toEqual(["wdio-obsidian-service-plugin"]);
        expect(!!theme4).toEqual(false);
        expect(files4).toEqual(["A.md", "B.md"]);


        // Test enabling a plugin via reloadObsidian
        await browser.reloadObsidian({vault: "./test/vaults/basic", plugins: ["basic-plugin"], theme: "Basic Theme"});
        const plugins5 = await getPlugins();
        const theme5 = await browser.executeObsidian(({app}) => (app as any).customCss.theme);

        expect(plugins5).toEqual(["basic-plugin", "wdio-obsidian-service-plugin"]);
        expect(theme5).toEqual("Basic Theme");


        // Test changing plugins without resetting vault
        await browser.reloadObsidian({plugins: [], theme: "default"});
        const plugins6: string[] = await getPlugins();
        const theme6 = await browser.execute("return app.customCss.theme");

        expect(plugins6).toEqual(['wdio-obsidian-service-plugin']);
        expect(theme6).toEqual("");
    })
})
