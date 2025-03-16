import { browser } from '@wdio/globals'
import { expect } from 'chai';
import fsAsync from "fs/promises"
import obsidianPage from '../../src/pageobjects/obsidianPage.js';


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
        expect(await getOpenFiles()).to.eql([]);
    })

    it('enable/disable plugin', async () => {
        let plugins: string[] = await browser.executeObsidian(({app}) =>
            [...(app as any).plugins.enabledPlugins].sort() 
        );
        expect(plugins).to.eql(["basic-plugin", "wdio-obsidian-service-plugin"]);

        await obsidianPage.disablePlugin("basic-plugin");
        plugins = await browser.executeObsidian(({app}) => [...(app as any).plugins.enabledPlugins].sort());
        expect(plugins).to.eql(["wdio-obsidian-service-plugin"]);

        await obsidianPage.enablePlugin("basic-plugin");
        plugins = await browser.executeObsidian(({app}) => [...(app as any).plugins.enabledPlugins].sort());
        expect(plugins).to.eql(["basic-plugin", "wdio-obsidian-service-plugin"]);
    })

    it('set theme', async () => {
        let theme = await browser.executeObsidian(({app}) => (app.vault as any).getConfig("cssTheme"));
        expect(theme).to.eql("Basic Theme");
        
        await obsidianPage.setTheme("default");
        theme = await browser.executeObsidian(({app}) => (app.vault as any).getConfig("cssTheme"));
        expect(theme).to.eql("");

        await obsidianPage.setTheme("Basic Theme");
        theme = await browser.executeObsidian(({app}) => (app.vault as any).getConfig("cssTheme"));
        expect(theme).to.eql("Basic Theme");
    })

    it("openFile", async () => {
        await obsidianPage.openFile("Welcome.md");
        expect(await getOpenFiles()).to.eql(["Welcome.md"]);

        await obsidianPage.openFile("Goodbye.md");
        expect(await getOpenFiles()).to.eql(["Goodbye.md", "Welcome.md"]);
    })

    it("loadWorkspaceLayout", async () => {
        expect(await getOpenFiles()).to.eql([]);
        await obsidianPage.loadWorkspaceLayout("saved-layout");
        expect(await getOpenFiles()).to.eql(["Goodbye.md", "Welcome.md"]);
    })

    it("loadWorkspaceLayout object", async () => {
        const workspacesPath = 'test/vaults/basic/.obsidian/workspaces.json';
        const workspaces = JSON.parse(await fsAsync.readFile(workspacesPath, 'utf-8'))
        const workspace = workspaces.workspaces['saved-layout'];
        expect(await getOpenFiles()).to.eql([]);
        await obsidianPage.loadWorkspaceLayout(workspace);
        expect(await getOpenFiles()).to.eql(["Goodbye.md", "Welcome.md"]);
    })
})
