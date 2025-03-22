import * as path from "path"
import * as fsAsync from "fs/promises"
import { OBSIDIAN_CAPABILITY_KEY } from "../types.js";
import { TFile } from "obsidian";
import _ from "lodash";

/**
 * Class with various helper methods for writing Obsidian tests using the
 * [page object pattern](https://webdriver.io/docs/pageobjects).
 * 
 * You can get an instance of this class either by running
 * ```ts
 * const obsidianPage = await browser.getObsidianPage();
 * ```
 * or just importing it directly with
 * ```ts
 * import { obsidianPage } from "wdio-obsidian-service";
 * ```
 */
class ObsidianPage {
    /**
     * Returns the path to the vault opened in Obsidian.
     * 
     * wdio-obsidian-service copies your vault before running tests, so this is the path to the temporary copy.
     */
    async getVaultPath(): Promise<string|undefined> {
        if (browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].vault == undefined) {
            return undefined; // no vault open
        } else { // return the actual path to the vault
            return await browser.executeObsidian(({app, obsidian}) => {
                if (app.vault.adapter instanceof obsidian.FileSystemAdapter) {
                    return app.vault.adapter.getBasePath()
                } else { // TODO handle CapacitorAdapater
                    throw new Error(`Unrecognized DataAdapater type`)
                };
            })
        }
    }

    /**
     * Enables a plugin by ID
     */
    async enablePlugin(pluginId: string): Promise<void> {
        await browser.executeObsidian(
            async ({app}, pluginId) => await (app as any).plugins.enablePluginAndSave(pluginId),
            pluginId,
        );
    }

    /**
     * Disables a plugin by ID
     */
    async disablePlugin(pluginId: string): Promise<void> {
        await browser.executeObsidian(
            async ({app}, pluginId) => await (app as any).plugins.disablePluginAndSave(pluginId),
            pluginId,
        );
    }

    /**
     * Sets the theme. Pass "default" to reset to the Obsidian theme.
     */
    async setTheme(themeName: string): Promise<void> {
        themeName = themeName == 'default' ? '' : themeName;
        await browser.executeObsidian(
            async ({app}, themeName) => await (app as any).customCss.setTheme(themeName),
            themeName,
        )
    }

    /**
     * Opens a file in a new tab.
     */
    async openFile(path: string) {
        await browser.executeObsidian(async ({app, obsidian}, path) => {
            const file = app.vault.getAbstractFileByPath(path);
            if (file instanceof obsidian.TFile) {
                await app.workspace.getLeaf('tab').openFile(file);
            } else {
                throw Error(`No file ${path} exists`);
            }
        }, path)
    }

    /**
     * Loads a saved workspace layout from `.obsidian/workspaces.json` by name. Use the core "Workspaces"
     * plugin to create the layouts. You can also pass the layout object directly.
     */
    async loadWorkspaceLayout(layout: any): Promise<void> {
        if (typeof layout == "string") {
            // read from .obsidian/workspaces.json like the built-in workspaces plugin does
            const vaultPath = (await this.getVaultPath())!;
            const workspacesPath = path.join(vaultPath, '.obsidian/workspaces.json');
            const layoutName = layout;
            try {
                const fileContent = await fsAsync.readFile(workspacesPath, 'utf-8');
                layout = JSON.parse(fileContent)?.workspaces?.[layoutName];
            } catch {
                throw new Error(`No workspace ${layoutName} found in .obsidian/workspaces.json`);
            }
        }

        await browser.executeObsidian(async ({app}, layout) => {
            await app.workspace.changeLayout(layout)
        }, layout)
    }

    /**
     * Resets the vault files to the original state by deleting/creating/modifying vault files in place without
     * reloading Obsidian.
     * 
     * This will only reset regular vault files, it won't touch anything under `.obsidian`, and it won't reset any
     * config and app state you've set in Obsidian. But if all you need is to reset the vault files, this can be used as
     * a faster alternative to reloadObsidian.
     * 
     * If no vault is passed, it resets the vault back to the oringal vault opened by the tests. You can also pass a
     * path to an different vault, and it will sync the current vault to match that one (similar to "rsync"). Or,
     * instead of passing a vault path you can pass an object mapping vault file paths to file content. E.g.
     * ```ts
     * obsidianPage.resetVault({
     *     'path/in/vault.md': "Hello World",
     * })
     * ```
     * 
     * You can also pass multiple vaults and the files will be merged. This can be useful if you want to add a few small
     * modifications to the base vault. e.g:
     * ```ts
     * obsidianPage.resetVault('./path/to/vault', {
     *    "books/leviathan-wakes.md": "...",
     * })
     * ```
     */
    async resetVault(...vaults: (string|Record<string, string>)[]) {
        const origVaultPath: string = browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].vault;
        vaults = vaults.length == 0 ? [origVaultPath] : vaults;

        const newVaultFiles: Record<string, {content?: string, path?: string}> = {};
        for (let vault of vaults) {
            if (typeof vault == "string") {
                vault = path.resolve(vault);
                const files = await fsAsync.readdir(vault, { recursive: true, withFileTypes: true });
                for (const file of files) {
                    const absPath = path.join(file.parentPath, file.name);
                    const obsPath = path.relative(vault, absPath).split(path.sep).join("/");
                    if (file.isFile() && !obsPath.startsWith(".obsidian/")) {
                        newVaultFiles[obsPath] = {path: absPath};
                    }
                }
            } else {
                for (const [file, content] of Object.entries(vault)) {
                    newVaultFiles[file] = {content};
                }
            }
        }

        // Get all subfolders in the new vault, sort parents are before children
        const newVaultFolders = _(newVaultFiles)
            .keys()
            .map(p => path.dirname(p))
            .filter(p => p != ".")
            .sort().uniq()
            .value();

        await browser.executeObsidian(async ({app, obsidian}, newVaultFolders, newVaultFiles) => {
            // the require is getting transpiled by tsup, so pull it directly from wdioObsidianService
            const fs = (window as any).wdioObsidianService.require('fs');

            // "rsync" the vault
            for (const newFolder of newVaultFolders) {
                let currFile = app.vault.getAbstractFileByPath(newFolder);
                if (currFile && currFile instanceof obsidian.TFile) {
                    await app.vault.delete(currFile);
                    currFile = null;
                }
                if (!currFile) {
                    await app.vault.createFolder(newFolder);
                }
            }
            // sort reversed, so children are before parents
            const currVaultFolders = app.vault.getAllLoadedFiles()
                .filter(f => f instanceof obsidian.TFolder)
                .sort((a, b) => b.path.localeCompare(a.path));
            const newVaultFoldersSet = new Set(newVaultFolders)
            for (const currFolder of currVaultFolders) {
                if (!newVaultFoldersSet.has(currFolder.path)) {
                    await app.vault.delete(currFolder, true);
                }
            }

            for (let [newFilePath, newFileSource] of Object.entries(newVaultFiles)) {
                let currFile = app.vault.getAbstractFileByPath(newFilePath);
                const content = newFileSource.content ?? await fs.readFileSync(newFileSource.path!, 'utf-8');
                if (currFile) {
                    await app.vault.modify(currFile as TFile, content);
                } else {
                    await app.vault.create(newFilePath, content);
                }
            }
            const newVaultFilesSet = new Set(Object.keys(newVaultFiles));
            for (const currVaultFile of app.vault.getFiles()) {
                if (!newVaultFilesSet.has(currVaultFile.path)) {
                    await app.vault.delete(currVaultFile);
                }
            }
        }, newVaultFolders, newVaultFiles);
    }
}

/**
 * Instance of ObsidianPage with helper methods for writing Obsidian tests
 */
const obsidianPage = new ObsidianPage()
export default obsidianPage;
export { ObsidianPage };
