import { browser } from '@wdio/globals'
import { expect } from 'chai';
import fsAsync from "fs/promises";
import path from "path";
import obsidianPage from '../../src/pageobjects/obsidianPage.js';
import { TFile } from 'obsidian';


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

    it('getVaultPath', async () => {
        const originalVaultPath = path.resolve("./test/vaults/basic");
        const vaultPath = (await obsidianPage.getVaultPath())!;
        
        // vault should be copied
        expect(path.resolve(vaultPath)).to.not.eql(originalVaultPath)
        expect(await fsAsync.readdir(vaultPath)).to.include.members(["Goodbye.md", "Welcome.md"]);
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

describe("resetVault", async () => {
    async function getAllFiles() {
        return await browser.executeObsidian(async ({app}) => {
            const result: Record<string, string> = {};
            for (const file of app.vault.getFiles()) {
                result[file.path] = await app.vault.read(file);
            }
            return result;
        })
    }

    it("no change", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        const contentBefore = await getAllFiles();
        expect(Object.keys(contentBefore).sort()).to.eql(["Goodbye.md", "Welcome.md"]);
        await obsidianPage.resetVaultFiles();
        expect(await getAllFiles()).to.eql(contentBefore);

        // Make sure it didn't update the files
        const vaultOrigPath = path.resolve("./test/vaults/basic");
        const vaultCopyPath = (await obsidianPage.getVaultPath())!;
        console.log({vaultOrigPath, vaultCopyPath});
        for (const file of await fsAsync.readdir(vaultOrigPath)) {
            if (!file.startsWith(".obsidian")) {
                const origMtime = await fsAsync.stat(path.join(vaultOrigPath, file));
                const copyMtime = await fsAsync.stat(path.join(vaultCopyPath, file));
                expect(origMtime.mtime.toISOString()).to.eql(copyMtime.mtime.toISOString());
            }
        }
    })

    it("update file", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/nested"});
        const contentBefore = await getAllFiles();

        await browser.executeObsidian(async ({app}) => {
            await app.vault.modify(app.vault.getAbstractFileByPath("B/C.md") as TFile, "changed");
        })

        await obsidianPage.resetVaultFiles();
        expect(await getAllFiles()).to.eql(contentBefore);
    })

    it("remove and create files", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        const contentBefore = await getAllFiles();

        await browser.executeObsidian(async ({app}) => {
            await app.vault.delete(app.vault.getAbstractFileByPath("B/C.md") as TFile);
            await app.vault.create("New.md", "A new file");
        })

        await obsidianPage.resetVaultFiles();
        expect(await getAllFiles()).to.eql(contentBefore);
    })

    it("empty vault", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/empty"});
        await obsidianPage.resetVaultFiles();
        expect(await getAllFiles()).to.eql({});

        await browser.executeObsidian(async ({app}) => {
            await app.vault.create("New.md", "A new file");
        })

        await obsidianPage.resetVaultFiles();
        expect(await getAllFiles()).to.eql({});
    })
})
