/** Plugin that is automatically loaded during tests and sets up some global variables. */
const obsidian = require('obsidian');

function toCamelCase(s) {
    return s.replace(/-\w/g, m => m[1].toUpperCase());
}

class WdioObsidianServicePlugin extends obsidian.Plugin {
    async onload() {
        const getGlobals = () => ({
            app: this.app,
            obsidian: obsidian,
            // need to rebuild plugins each time, as the plugins can change on disable/enable.
            plugins: Object.fromEntries(
                Object.entries(this.app.plugins.plugins)
                    .filter(([id, plugin]) => id != "wdio-obsidian-service-plugin")
                    .map(([id, plugin]) => [toCamelCase(id), plugin])
            ),
            // Obsidian uses a magic wrapper for the require seen by plugins that can import Obsidian modules
            require: require,
        });

        // pop-out windows have separate window objects so the globals don't tranfer by default. webdriverio normally
        // executes in the main window but you can switch that with `switchWindow`. Here we add the global to all
        // windows so executeObsidian still works.
        const windows = new Set([this.app.workspace.rootSplit?.win ?? window]);
        this.app.workspace.iterateAllLeaves(l => { windows.add(l.getContainer().win) });
        for (const win of windows) {
            win.wdioObsidianService = getGlobals;
        }
        this.registerEvent(this.app.workspace.on("window-open", (win) => {
            win.win.wdioObsidianService = getGlobals;
        }))
    };
}

module.exports = WdioObsidianServicePlugin;
