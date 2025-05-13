import * as path from "path"
import * as fs from "fs"
import * as fsAsync from "fs/promises"
import { OBSIDIAN_CAPABILITY_KEY } from "../types.js";
import { BasePage } from "./basePage.js";
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
 * 
 * @hideconstructor
 */
class ObsidianPage extends BasePage {
    /**
     * Returns the path to the vault opened in Obsidian.
     * 
     * wdio-obsidian-service copies your vault before running tests, so this is the path to the temporary copy.
     */
    getVaultPath(): string {
        const vault = this.browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].vaultCopy;
        if (vault === undefined) {
            throw Error("No vault open, set vault in wdio.conf or use reloadObsidian to open a vault dynamically.")
        }
        return vault;
    }

    /**
     * Return the path to the Obsidian config dir (".obsidian" unless you've changed it explicitly)
     */
    async getConfigDir(): Promise<string> {
        return await this.browser.executeObsidian(({app}) => {
            return app.vault.configDir;
        })
    }

    /**
     * Enables a plugin by ID
     */
    async enablePlugin(pluginId: string): Promise<void> {
        await this.browser.executeObsidian(
            async ({app}, pluginId) => await (app as any).plugins.enablePluginAndSave(pluginId),
            pluginId,
        );
    }

    /**
     * Disables a plugin by ID
     */
    async disablePlugin(pluginId: string): Promise<void> {
        await this.browser.executeObsidian(
            async ({app}, pluginId) => await (app as any).plugins.disablePluginAndSave(pluginId),
            pluginId,
        );
    }

    /**
     * Sets the theme. Pass "default" to reset to the Obsidian theme.
     */
    async setTheme(themeName: string): Promise<void> {
        themeName = themeName == 'default' ? '' : themeName;
        await this.browser.executeObsidian(
            async ({app}, themeName) => await (app as any).customCss.setTheme(themeName),
            themeName,
        )
    }

    /**
     * Opens a file in a new tab.
     */
    async openFile(path: string) {
        await this.browser.executeObsidian(async ({app, obsidian}, path) => {
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
            const configDir = await this.getConfigDir();
            const workspacesPath = path.join(this.getVaultPath(), configDir, 'workspaces.json');
            const layoutName = layout;
            try {
                const fileContent = await fsAsync.readFile(workspacesPath, 'utf-8');
                layout = JSON.parse(fileContent)?.workspaces?.[layoutName];
            } catch {
                throw new Error(`No workspace ${layoutName} found in ${configDir}/workspaces.json`);
            }
        }

        await this.browser.executeObsidian(async ({app}, layout) => {
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
     * path to a different vault, and it will sync the current vault to match that one (similar to "rsync"). Or,
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
        const origVaultPath: string = this.browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].vault;
        vaults = vaults.length == 0 ? [origVaultPath] : vaults;
        const configDir = await this.getConfigDir();

        async function readVaultFiles(vault: string): Promise<Map<string, fs.Stats>> {
            const files = await fsAsync.readdir(vault, { recursive: true, withFileTypes: true });
            const paths = files
                .filter(f => f.isFile())
                .map(f => path.relative(vault, path.join(f.parentPath, f.name)).split(path.sep).join("/"))
                .filter(f => !f.startsWith(configDir + "/"));
            const promises = paths.map(async (p) => [p, await fsAsync.stat(path.join(vault, p))] as const);
            return new Map(await Promise.all(promises));
        }

        function getFolders(files: Iterable<string>): Set<string> {
            return new Set([...files].map(p => path.dirname(p)).filter(p => p != '.'));
        }

        // merge the vaults
        const newFiles: Map<string, {stat?: fs.Stats, sourcePath?: string, sourceContent?: string}> = new Map();
        for (let vault of vaults) {
            if (typeof vault == "string") {
                vault = path.resolve(vault);
                for (const [file, stat] of await readVaultFiles(vault)) {
                    newFiles.set(file, {stat, sourcePath: path.join(vault, file)});
                }
            } else {
                for (const [file, sourceContent] of Object.entries(vault)) {
                    newFiles.set(file, {sourceContent});
                }
            }
        }

        // calculate the changes needed to the current vault
        const newFolders = getFolders(newFiles.keys());
        const currFiles = await readVaultFiles(this.getVaultPath());
        const currFolders = getFolders(currFiles.keys());

        type FileUpdateInstruction = {
            action: string, path: string,
            sourcePath?: string, sourceContent?: string,
        };
        const instructions: FileUpdateInstruction[] = [];

        // delete files
        for (const currFile of currFiles.keys()) {
            if (!newFiles.has(currFile)) {
                instructions.push({action: "delete-file", path: currFile});
            }
        }
        // delete folders, sort so children are before parents
        for (const currFolder of [...currFolders].sort().reverse()) {
            if (!newFolders.has(currFolder)) {
                instructions.push({action: "delete-folder", path: currFolder});
            }
        }
        // create folders, sort so parents are before children
        for (const newFolder of [...newFolders].sort()) {
            if (!currFolders.has(newFolder)) {
                instructions.push({action: "create-folder", path: newFolder});
            }
        }
        // create/modify files
        for (let [newFile, newFileInfo] of newFiles.entries()) {
            const {stat: newStat, sourcePath, sourceContent} = newFileInfo;
            const args = {path: newFile, sourcePath, sourceContent};
            const currStat = currFiles.get(newFile);
            if (!currStat) {
                instructions.push({action: "create-file", ...args});
            } else if ( // check if file has changed (setupVault preserves mtimes)
                !newStat ||
                currStat.mtime.getTime() != newStat.mtime.getTime() ||
                currStat.size != newStat.size
            ) {
                instructions.push({action: "modify-file", ...args});
            }
        }

        await this.browser.executeObsidian(async ({app, require}, instructions) => {
            // the require is getting transpiled by tsup, so use it from args instead of globally
            const fs = require('fs');
    
            for (const {action, path, sourcePath, sourceContent} of instructions) {
                const isHidden = path.split("/").some(p => p.startsWith("."));
                if (action == "delete-file") {
                    if (isHidden) {
                        await app.vault.adapter.remove(path);
                    } else {
                        await app.vault.delete(app.vault.getAbstractFileByPath(path)!);
                    }
                } else if (action == "delete-folder") {
                    if (isHidden) {
                        await app.vault.adapter.rmdir(path, true);
                    } else {
                        await app.vault.delete(app.vault.getAbstractFileByPath(path)!, true);
                    }
                } else if (action == "create-folder") {
                    if (isHidden) {
                        await app.vault.adapter.mkdir(path);
                    } else {
                        await app.vault.createFolder(path);
                    }
                } else if (action == "create-file" || action == "modify-file") {
                    const content = sourceContent ?? await fs.readFileSync(sourcePath!, 'utf-8');
                    if (isHidden) {
                        await app.vault.adapter.write(path, content);
                    } else if (action == "modify-file") {
                        await app.vault.modify(app.vault.getAbstractFileByPath(path) as TFile, content);
                    } else { // action == "create-file"
                        await app.vault.create(path, content);
                    }
                } else {
                    throw Error(`Unknown action ${action}`)
                }
            }
        }, instructions);
    }
}

/**
 * Instance of {@link ObsidianPage} with helper methods for writing Obsidian tests.
 */
const obsidianPage = new ObsidianPage()
export default obsidianPage;
export { ObsidianPage };
