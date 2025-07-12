import * as path from "path"
import * as fsAsync from "fs/promises"
import * as crypto from "crypto";
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
    async resetVault(...vaults: (string|Record<string, string|ArrayBuffer>)[]) {
        const obsidianOptions = this.getObsidianCapabilities();
        if (!obsidianOptions.vault) {
            // open an empty vault if there's no vault open
            const defaultVaultPath = path.resolve(fileURLToPath(import.meta.url), '../../default-vault');
            await this.browser.reloadObsidian({vault: defaultVaultPath});
        }
        const configDir = path.basename(await this.getConfigDir());
        vaults = vaults.length == 0 ? [obsidianOptions.vault!] : vaults;

        // helper functions
        const isHidden = (file: string) => file.split("/").some(p => p.startsWith("."));
        const isText = (file: string) =>
            [".md", ".json", ".txt", ".js"].includes(path.extname(file).toLocaleLowerCase())

        const deleteFile = async (file: string) => {
            await this.browser.executeObsidian(async ({app}, file, isVaultFile) => {
                if (isVaultFile) {
                    await app.vault.delete(app.vault.getAbstractFileByPath(file)!);
                } else {
                    await app.vault.adapter.remove(file);
                }
            }, file, !isHidden(file) && isText(file));
        }
        const deleteFolder = async (file: string) => {
            await this.browser.executeObsidian(async ({app}, file, isVaultFile) => {
                if (isVaultFile) {
                    await app.vault.delete(app.vault.getAbstractFileByPath(file)!, true);
                } else {
                    await app.vault.adapter.rmdir(file, true);
                }
            }, file, !isHidden(file));
        }
        const writeFile = async (file: string, content: string|ArrayBuffer) => {
            let strContent: string|undefined, binContent: string|undefined;
            if (typeof content == "string") {
                strContent = content;
            } else {
                binContent = Buffer.from(content).toString("base64");
            }
            await this.browser.executeObsidian(async ({app}, file, isVaultFile, strContent, binContent) => {
                if (isVaultFile) {
                    const fileObj = app.vault.getAbstractFileByPath(file);
                    strContent = strContent ?? atob(binContent!);
                    if (fileObj) {
                        await app.vault.modify(fileObj as TFile, strContent);
                    } else {
                        await app.vault.create(file, strContent);
                    }
                } else if (strContent) {
                    await app.vault.adapter.write(file, strContent);
                } else {
                    const buffer = new TextEncoder().encode(atob(binContent!)).buffer;
                    await app.vault.adapter.writeBinary(file, buffer)
                }
            }, file, !isHidden(file) && isText(file), strContent, binContent);
        }
        const createFolder = async (file: string) => {
            await this.browser.executeObsidian(async ({app}, file, isVaultFile) => {
                if (isVaultFile) {
                    await app.vault.createFolder(file);
                } else {
                    await app.vault.adapter.mkdir(file);
                }
            }, file, !isHidden(file));
        }

        // list all files in the new vault
        type NewFileInfo = {type: "file"| "folder", sourceContent?: string|ArrayBuffer, sourceFile?: string};
        const newVault: Map<string, NewFileInfo> = new Map();
        for (let vault of vaults) {
            if (typeof vault == "string") {
                vault = path.resolve(vault);
                const files = await fsAsync.readdir(vault, { recursive: true, withFileTypes: true });
                for (const f of files) {
                    const fullPath = path.join(f.parentPath, f.name);
                    const vaultPath = path.relative(vault, fullPath).split(path.sep).join("/");
                    if (!vaultPath.startsWith(configDir + "/")) {
                        if (f.isDirectory()) {
                            newVault.set(vaultPath, {type: 'folder'});
                        } else {
                            newVault.set(vaultPath, {type: 'file', sourceFile: fullPath});
                        }
                    }
                }
            } else {
                for (const [file, content] of Object.entries(vault)) {
                    newVault.set(file, {type: "file", sourceContent: content});
                }
                const folders = new Set(Object.keys(vault).map(p => path.posix.dirname(p)).filter(p => p !== "."));
                for (const folder of folders) {
                    newVault.set(folder, {type: "folder"});
                }
            }
        }

        // list all files in the current vault
        type CurrFileInfo = {type: "file"| "folder", hash?: string};
        const currVault = new Map(await this.browser.executeObsidian(({app}, configDir) => {
            async function hash(data: ArrayBuffer) {
                const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            }

            async function listRecursive(path: string): Promise<[string, CurrFileInfo][]> {
                const result: [string, CurrFileInfo][] = [];
                const { folders, files } = await app.vault.adapter.list(path);
                for (const folder of folders) {
                    result.push([folder, {type: "folder"}]);
                    result.push(...await listRecursive(folder));
                }
                for (const file of files) {
                    if (!file.startsWith(configDir + "/")) {
                        const content = await app.vault.adapter.readBinary(file);
                        result.push([file, { type: "file", hash: await hash(content) }]);
                    }
                }
                return result;
            }

            return listRecursive("/");
        }, configDir));

        // delete any files that need to be deleted
        for (const file of [...currVault.keys()].sort().reverse()) {
            const currFileInfo = currVault.get(file)!
            if (!newVault.has(file) || newVault.get(file)!.type != currFileInfo.type) {
                if (currFileInfo.type == "file") {
                    await deleteFile(file);
                } else {
                    await deleteFolder(file);
                }
            }
        }

        // create files and folders
        for (const [file, newFileInfo] of _.sortBy([...newVault.entries()], 0)) {
            const currFileInfo = currVault.get(file);
            if (newFileInfo.type == "file") {
                const content = newFileInfo.sourceContent ?? await fsAsync.readFile(newFileInfo.sourceFile!);
                const hash = crypto.createHash("SHA256")
                    .update(typeof content == "string" ? content : new Uint8Array(content))
                    .digest("hex");
                if (!currFileInfo || currFileInfo.hash != hash) {
                    await writeFile(file, content);
                }
            } else if (newFileInfo.type == "folder" && !currFileInfo) {
                await createFolder(file);
            }
        }
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
