import * as path from "path"
import * as fsAsync from "fs/promises"
import { OBSIDIAN_CAPABILITY_KEY } from "../types.js";
import { TFile } from "obsidian";

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

        // Click on the status-bar to focus the main window in case there are multiple Obsidian windows panes
        await $(".status-bar").click();
        await browser.executeObsidian(async ({app}, layout) => {
            await app.workspace.changeLayout(layout)
        }, layout)
    }

    /** Cache mtimes of original vault files */
    private originalVaults: Record<string, Record<string, number>> = {};

    /**
     * Resets vault files to the initial state of the vault without reloading Obsidian.
     * Does not reset any `.obsidian` configuration. Can be a faster alternative to "reloadObsidian" if you only need
     * to reset normal vault files between tests.
     */
    async resetVaultFiles() {
        const origVaultPath = browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY].vault;

        // Get the mtimes of the original vault (the vault copy preserves timestamps)
        if (!this.originalVaults[origVaultPath]) {
            const files = await fsAsync.readdir(origVaultPath, { recursive: true, withFileTypes: true });
            const mtimes: Record<string, number> = {};
            for (const file of files) {
                const absPath = path.join(file.parentPath, file.name);
                // Obsidian always uses "/" for paths
                const obsPath = path.relative(origVaultPath, absPath).replace(path.sep, "/");
                if (file.isFile() && !obsPath.startsWith(".obsidian/")) {
                    mtimes[obsPath] = (await fsAsync.stat(absPath)).mtime.getTime();
                }
            }
            this.originalVaults[origVaultPath] = mtimes;
        }

        const originalMtimes = this.originalVaults[origVaultPath];
        await browser.executeObsidian(async ({app}, origVaultPath, originalMtimes) => {
            const fs = require('fs');
            const path = require('path');

            for (const file of app.vault.getFiles()) {
                // Fetch the file again to make sure mtime is up to date (not sure this is necessary)
                const mtime = (app.vault.getAbstractFileByPath(file.path) as TFile).stat.mtime;
                if (originalMtimes[file.path]) {
                    if (mtime > originalMtimes[file.path]) {
                        app.vault.modify(file, fs.readFileSync(path.join(origVaultPath, file.path), 'utf-8'));
                    }
                    delete originalMtimes[file.path];
                } else {
                    app.vault.delete(file);
                }
            }
            // Any files still left in originalMtimes need to be created
            for (const file of Object.keys(originalMtimes)) {
                app.vault.create(file, fs.readFileSync(path.join(origVaultPath, file), 'utf-8'))
            }
        }, origVaultPath, originalMtimes);
    }
}

/**
 * Instance of ObsidianPage with helper methods for writing Obsidian tests
 */
const obsidianPage = new ObsidianPage()
export default obsidianPage;
export { ObsidianPage };
