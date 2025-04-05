import { browser } from '@wdio/globals'
import fsAsync from "fs/promises";
import path from "path";
import { obsidianPage } from 'wdio-obsidian-service';


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
    beforeEach(async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        await obsidianPage.loadWorkspaceLayout("empty");
        expect(await getOpenFiles()).toEqual([]);
    })

    it('getVaultPath', async () => {
        const originalVaultPath = path.resolve("./test/vaults/basic");
        const vaultPath = (await obsidianPage.getVaultPath())!;
        
        // vault should be copied
        expect(path.resolve(vaultPath)).not.toEqual(originalVaultPath)
        expect(await fsAsync.readdir(vaultPath)).toEqual(expect.arrayContaining(["Goodbye.md", "Welcome.md"]));
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
