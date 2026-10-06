/** Plugin that is automatically loaded during tests and sets up some global variables. */
const obsidian = require('obsidian');

function toCamelCase(s) {
    return s.replace(/-\w/g, m => m[1].toUpperCase());
}

class WdioObsidianServicePlugin extends obsidian.Plugin {
    async onload() {
        const app = this.app;
        const getGlobals = () => ({
            app: app,
            obsidian: obsidian,
            // need to rebuild plugins each time, as the plugins can change on disable/enable.
            plugins: Object.fromEntries(
                Object.entries(app.plugins.plugins)
                    .filter(([id, plugin]) => id != "wdio-obsidian-service-plugin")
                    .map(([id, plugin]) => [toCamelCase(id), plugin])
            ),
            // Obsidian uses a magic wrapper for the require seen by plugins that can import Obsidian modules
            require: require,
        });

        const patchWindow = (win) => {
            // I'm not handling plugin unloading, but we still need to make sure hot-reload doesn't cause an issue.
            if (win.wdioObsidianService) return;
            win.wdioObsidianService = getGlobals;

            const orig = win.open;
            function patch(...args) {
                const result = orig.call(this, ...args);
                if (result) {
                    patchWindow(result);
                }
                return result;
            }
            win.open = patch;
        }

        if (obsidian.Platform.isMobileApp) {
            window.wdioObsidianService = getGlobals;
        } else {
            // set wdioObsidianService globals on every window so executeObsidian works regardless of selected window.
            // Note, Obsidian has an official window-open which would be nicer. However that only triggers for normal file
            // windows. The Obsidian settings page and the plugin browser also open in windows and don't trigger open-window.
            // The only reliable way I can find to catch ALL windows is to patch window.open.
            app.workspace.onLayoutReady(() => {
                const windows = new Set([window]);
                this.app.workspace.iterateAllLeaves(l => { windows.add(l.getContainer().win) });
                for (const win of windows) {
                    patchWindow(win);
                }
            });
            // still use window-open as a fallback though
            this.registerEvent(this.app.workspace.on("window-open", (win) => {
                patchWindow(win.win);
            }));
        }
    };
}

module.exports = WdioObsidianServicePlugin;
