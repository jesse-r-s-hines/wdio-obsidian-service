import { browser, expect } from '@wdio/globals'
import fsAsync from "fs/promises";
import path from "path";
import { obsidianPage } from 'wdio-obsidian-service';
import { OBSIDIAN_CAPABILITY_KEY } from '../../src/types.js';
import { isAppium } from '../../src/utils.js';


async function getOpenFiles() {
    return await browser.executeObsidian(({app}) => {
        const leaves: string[] = []
        app.workspace.iterateRootLeaves(l => {
            const file = l.getViewState()?.state?.file;
            if (file) {
                leaves.push(file as string);
            }
        });
        return leaves.sort();
    });
}

describe("Test page object", () => {
    before(async () => {
        expect(() => obsidianPage.getVaultPath()).toThrow("No vault open");
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
    })

    beforeEach(async () => {
        await obsidianPage.loadWorkspaceLayout("empty");
        expect(await getOpenFiles()).toEqual([]);
    })

    it('getVaultPath', async () => {
        const originalVaultPath = path.resolve("./test/vaults/basic");
        const vaultPath1 = obsidianPage.getVaultPath();
        
        // vault should be copied
        expect(path.resolve(vaultPath1)).not.toEqual(originalVaultPath)
        if ((await obsidianPage.getPlatform()).isMobileApp) {
            expect(vaultPath1).toMatch("wdio-obsidian-service-vaults");
        }

        await browser.reloadObsidian({vault: "./test/vaults/basic"});

        // New copy
        const vaultPath2 = obsidianPage.getVaultPath();
        expect(path.resolve(vaultPath2)).not.toEqual(path.resolve(vaultPath1));

        // Keeps the same copy
        await browser.reloadObsidian();
        const vaultPath3 = obsidianPage.getVaultPath();
        expect(vaultPath3).toEqual(vaultPath3);
    })

    it('getConfigDir', async () => {
        const configDir = await obsidianPage.getConfigDir();
        expect(configDir).toEqual(".obsidian");
    })

    it('getPlatform', async () => {
        const platform = await obsidianPage.getPlatform();
        const isEmulateMobile = browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].emulateMobile;
        const isAndroid = isAppium(browser.requestedCapabilities);

        expect(platform.isMobile).toEqual(isEmulateMobile || isAndroid);
        expect(platform.isDesktop).toEqual(!isEmulateMobile && !isAndroid);
        expect(platform.isPhone).toEqual(isEmulateMobile || isAndroid);

        expect(platform.isMobileApp).toEqual(isAndroid);
        expect(platform.isDesktopApp).toEqual(!isAndroid);

        expect(platform.isMacOS).toEqual(!isAndroid && process.platform == 'darwin');
        expect(platform.isWin).toEqual(!isAndroid && process.platform == 'win32');
        expect(platform.isLinux).toEqual(isAndroid || process.platform == 'linux');
    })

    it('enable/disable plugin', async () => {
        let plugins: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort() 
        );
        expect(plugins).toEqual(["basic-plugin", "wdio-obsidian-service-plugin"]);

        await obsidianPage.disablePlugin("basic-plugin");
        plugins = await browser.executeObsidian(({app}) => [...(app as any).plugins.enabledPlugins].sort());
        expect(plugins).toEqual(["wdio-obsidian-service-plugin"]);

        await obsidianPage.enablePlugin("basic-plugin");
        plugins = await browser.executeObsidian(({app}) => [...(app as any).plugins.enabledPlugins].sort());
        expect(plugins).toEqual(["basic-plugin", "wdio-obsidian-service-plugin"]);
    })

    it('set theme', async () => {
        let theme = await browser.executeObsidian(({app}) => (app.vault as any).getConfig("cssTheme"));
        expect(theme).toEqual("Basic Theme");
        
        await obsidianPage.setTheme("default");
        theme = await browser.executeObsidian(({app}) => (app.vault as any).getConfig("cssTheme"));
        expect(theme).toEqual("");

        await obsidianPage.setTheme("Basic Theme");
        theme = await browser.executeObsidian(({app}) => (app.vault as any).getConfig("cssTheme"));
        expect(theme).toEqual("Basic Theme");
    })

    it("openFile", async () => {
        await obsidianPage.openFile("Welcome.md");
        expect(await getOpenFiles()).toEqual(["Welcome.md"]);

        await obsidianPage.openFile("Goodbye.md");
        expect(await getOpenFiles()).toEqual(["Goodbye.md", "Welcome.md"]);
    })

    it("loadWorkspaceLayout", async () => {
        expect(await getOpenFiles()).toEqual([]);
        await obsidianPage.loadWorkspaceLayout("saved-layout");
        expect(await getOpenFiles()).toEqual(["Goodbye.md", "Welcome.md"]);
    })

    it("loadWorkspaceLayout object", async () => {
        const workspacesPath = 'test/vaults/basic/.obsidian/workspaces.json';
        const workspaces = JSON.parse(await fsAsync.readFile(workspacesPath, 'utf-8'))
        const workspace = workspaces.workspaces['saved-layout'];
        expect(await getOpenFiles()).toEqual([]);
        await obsidianPage.loadWorkspaceLayout(workspace);
        expect(await getOpenFiles()).toEqual(["Goodbye.md", "Welcome.md"]);
    })
})
