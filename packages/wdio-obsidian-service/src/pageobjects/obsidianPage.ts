import * as path from "path"
import * as fs from "fs"
import * as fsAsync from "fs/promises"
import { fileURLToPath } from "url";
import { TFile } from "obsidian";
import { OBSIDIAN_CAPABILITY_KEY, NormalizedObsidianCapabilityOptions } from "../types.js";
import { BasePage } from "./basePage.js";
import { isAppium } from "../utils.js";
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
 * @category Utilities
 */
class ObsidianPage extends BasePage {
    private getObsidianCapabilities(): NormalizedObsidianCapabilityOptions {
        return this.browser.requestedCapabilities[OBSIDIAN_CAPABILITY_KEY];
    }

    /**
     * Returns the path to the vault opened in Obsidian.
     * 
     * wdio-obsidian-service copies your vault before running tests, so this is the path to the temporary copy.
     */
    getVaultPath(): string {
        const obsidianOptions = this.getObsidianCapabilities();
        if (obsidianOptions.vaultCopy === undefined) {
            throw Error("No vault open, set vault in wdio.conf or use reloadObsidian to open a vault dynamically.")
        }
        return obsidianOptions.uploadedVault ?? obsidianOptions.vaultCopy;
    }

    /**
     * Return the full path to the Obsidian config dir ("path/to/vault/.obsidian" unless you changed the config dir
     * name).
     */
    async getConfigDir(): Promise<string> {
        // You can theoretically change the config dir name
        const dirName = await this.browser.executeObsidian(({app}) => {
            return app.vault.configDir;
        })
        const vaultPath = this.getVaultPath();
        return path.join(vaultPath, dirName);
    }

    /**
     * Returns the Obsidian Platform object. Useful for skipping tests based on whether we running in desktop or
     * (emulated) mobile, or based on OS.
     */
    async getPlatform(): Promise<Platform> {
        const obsidianOptions = this.getObsidianCapabilities();
        if (obsidianOptions.vault !== undefined) {
            return await this.browser.executeObsidian(({obsidian}) => {
                const p = obsidian.Platform;
                return {
                    isDesktop: p.isDesktop,
                    isMobile: p.isMobile,
                    isDesktopApp: p.isDesktopApp,
                    isMobileApp: p.isMobileApp,
                    isIosApp: p.isIosApp,
                    isAndroidApp: p.isAndroidApp,
                    isPhone: p.isPhone,
                    isTablet: p.isTablet,
                    isMacOS: p.isMacOS,
                    isWin: p.isWin,
                    isLinux: p.isLinux,
                    isSafari: p.isSafari,
                };
            });
        } else {
            // hack to allow calling getPlatform before opening a vault. This is needed so you can use getPlatform to
            // skip a test before wasting time opening the vault. we don't use this method the rest of the time as you
            // can technically change the size or switch emulation mode during tests
            const appium = isAppium(this.browser.requestedCapabilities);
            const emulateMobile = obsidianOptions.emulateMobile;
            const [width, height] = await this.browser.execute(() => [window.innerWidth, window.innerHeight]);

            let isTablet = false;
            let isPhone = false;
            if (appium || emulateMobile) {
                // replicate Obsidian's tablet vs phone breakpoint
                isTablet = (width >= 600 && height >= 600);
                isPhone = !isTablet;
            }

            return {
                isDesktop: !(appium || emulateMobile),
                isMobile: appium || emulateMobile,
                isDesktopApp: !appium,
                isMobileApp: appium,
                isIosApp: false, // iOS is not supported
                isAndroidApp: appium,
                isPhone: isPhone,
                isTablet: isTablet,
                isMacOS: !appium && process.platform == 'darwin',
                isWin: !appium && process.platform == 'win32',
                isLinux: !appium && process.platform == 'linux',
                isSafari: false, // iOS is not supported
            };
        }
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
                const leaf = app.workspace.getLeaf('tab');
                await leaf.openFile(file);
                app.workspace.setActiveLeaf(leaf, {focus: true});
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
            const workspacesPath = `${path.basename(configDir)}/workspaces.json`;
            const layoutName = layout;
            try {
                const fileContent = await this.browser.executeObsidian(async ({app}, workspacesPath) => {
                    return await app.vault.adapter.read(workspacesPath);
                }, workspacesPath);
                layout = JSON.parse(fileContent)?.workspaces?.[layoutName];
            } catch {
                throw new Error(`Failed to load ${configDir}/workspaces.json`);
            }
            if (!layout) {
                throw new Error(`No workspace ${layoutName} found in ${configDir}/workspaces.json`);
            }
        }

        await this.browser.executeObsidian(async ({app}, layout) => {
            await app.workspace.changeLayout(layout)
        }, layout)
    }

    /**
     * Updates the vault by modifying files in place without reloading Obsidian. Can be used to reset the vault back to
     * its original state or to "switch" to an entirely different vault without rebooting Obsidian
     * 
     * This will only update regular vault files, it won't touch anything under `.obsidian`, and it won't reset any
     * config and app state you've set in Obsidian. But if all you need is to reset the vault files, this can be used as
     * a faster alternative to reloadObsidian.
     * 
     * If no vault is passed, it resets the vault back to the oringal vault opened by the tests. You can also pass a
     * path to a different vault, and it will replace the current files with the files of that vault (similar to an
     * "rsync"). Or, instead of passing a vault path you can pass an object mapping vault file paths to file content.
     * E.g.
     * ```ts
     * obsidianPage.resetVault({
     *     'path/in/vault.md': "Hello World",
     * })
     * ```
     * 
     * You can also pass multiple vaults and objects, and they will be merged. This can be useful if you want to add a
     * few small modifications to the base vault. e.g:
     * ```ts
     * obsidianPage.resetVault('./path/to/vault', {
     *    "books/leviathan-wakes.md": "...",
     * })
     * ```
     */
    async resetVault(...vaults: (string|Record<string, string>)[]) {
        const obsidianOptions = this.getObsidianCapabilities();
        if (!obsidianOptions.vault) {
            // open an empty vault if there's no vault open
            const defaultVaultPath = path.resolve(fileURLToPath(import.meta.url), '../../default-vault');
            await this.browser.reloadObsidian({vault: defaultVaultPath});
        }

        const origVaultPath = obsidianOptions.vault!;

        vaults = vaults.length == 0 ? [origVaultPath] : vaults;
        const configDir = path.basename(await this.getConfigDir());

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
        for (const [newFile, newFileInfo] of newFiles.entries()) {
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

        await this.browser.executeObsidian(async ({app}, instructions) => {
            // The plugin require blocks node imports when emulating mobile, so use window.require to bypass that.
            const fs = window.require('fs');
    
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
 * Info on the platform we are running on or emulating, in similar format as
 * [obsidian.Platform](https://docs.obsidian.md/Reference/TypeScript+API/Platform)
 * @category Types
 */
export interface Platform {
    /**
     * The UI is in desktop mode.
     */
    isDesktop: boolean;
    /**
     * The UI is in mobile mode.
     */
    isMobile: boolean;
    /**
     * We're running the electron-based desktop app.
     * Note, when running under `emulateMobile` this will still be true and isDesktop will be false.
     */
    isDesktopApp: boolean;
    /**
     * We're running the capacitor-js mobile app.
     * Note, when running under `emulateMobile` this will still be false and isMobile will be true.
     */
    isMobileApp: boolean;
    /** 
     * We're running the iOS app.
     * Note, wdio-obsidian-service doesn't support iOS yet, so this will always be false.
     */
    isIosApp: boolean;
    /**
     * We're running the Android app.
     */
    isAndroidApp: boolean;
    /**
     * We're in a mobile app that has very limited screen space.
     */
    isPhone: boolean;
    /**
     * We're in a mobile app that has sufficiently large screen space.
     */
    isTablet: boolean;
    /**
     * We're on a macOS device, or a device that pretends to be one (like iPhones and iPads).
     * Typically used to detect whether to use command-based hotkeys vs ctrl-based hotkeys.
     */
    isMacOS: boolean;
    /**
     * We're on a Windows device.
     */
    isWin: boolean;
    /**
     * We're on a Linux device.
     */
    isLinux: boolean;
    /**
     * We're running in Safari.
     * Note, wdio-obsidian-service doesn't support iOS yet, so this will always be false.
     */
    isSafari: boolean;
};

/**
 * Instance of {@link ObsidianPage} with helper methods for writing Obsidian tests.
 * @category Utilities
 */
const obsidianPage = new ObsidianPage()
export default obsidianPage;
export { ObsidianPage };
