import * as path from "path"
import * as fsAsync from "fs/promises"

/**
 * Class with various helper methods for writing Obsidian tests using the
 * [page object pattern](https://webdriver.io/docs/pageobjects).
 */
class ObsidianPage {
    /** Enables a plugin */
    async enablePlugin(pluginId: string): Promise<void> {
        await browser.executeObsidian(
            async ({app}, pluginId) => await (app as any).plugins.enablePluginAndSave(pluginId),
            pluginId,
        );
    }

    /** Disables a plugin */
    async disablePlugin(pluginId: string): Promise<void> {
        await browser.executeObsidian(
            async ({app}, pluginId) => await (app as any).plugins.disablePluginAndSave(pluginId),
            pluginId,
        );
    }

    /** Sets the theme. Pass "default" to reset to the Obsidian theme. */
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
     * Loads a saved workspace from `workspaces.json` by name. You can use the core "Workspaces" plugin to create the
     * layouts.
     */
    async loadWorkspaceLayout(layoutName: string): Promise<void> {
        // read from .obsidian/workspaces.json like the built-in workspaces plugin does
        const vaultPath = (await browser.getVaultPath())!;
        const workspacesPath = path.join(vaultPath, '.obsidian/workspaces.json');
    
        let layout: any = undefined
        try {
            layout = await fsAsync.readFile(workspacesPath, 'utf-8')
        } catch {
            throw new Error(`No workspace ${layout} found in .obsidian/workspaces.json`);
        }
        layout = JSON.parse(layout).workspaces?.[layoutName];
    
        // Click on the status-bar to focus the main window in case there are multiple Obsidian windows panes
        await $(".status-bar").click();
        await browser.executeObsidian(async ({app}, layout) => {
            await app.workspace.changeLayout(layout)
        }, layout)
    }
    
}

const obsidianPage = new ObsidianPage()
export default obsidianPage;
export { ObsidianPage };
