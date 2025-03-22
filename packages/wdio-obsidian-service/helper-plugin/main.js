/** Plugin that is automatically loaded during tests and sets up some global variables. */
const obsidian = require('obsidian');

function toCamelCase(s) {
    return s.replace(/-\w/g, m => m[1].toUpperCase());
}

class WdioObsidianServicePlugin extends obsidian.Plugin {
    async onload() {
        const globals = {
            app: this.app,
            obsidian: obsidian,
            plugins: Object.fromEntries(
                Object.entries(this.app.plugins.plugins)
                    .filter(([id, plugin]) => id != "wdio-obsidian-service-plugin")
                    .map(([id, plugin]) => [toCamelCase(id), plugin])
            ),
            // Obsidian uses a magic wrapper for the require seen by plugins that can import Obsidian modules
            require: require,
        }

        window.wdioObsidianService = globals;
        // pop-out windows have separate window objects so the globals don't tranfer by default. webdriverio normally
        // executes in the main window but you can switch that with `switchWindow`. Here we add the global to all
        // windows so executeObsidian still works.
        this.registerEvent(this.app.workspace.on("window-open", (win) => {
            win.win.wdioObsidianService = globals;
        }))
    };
}

module.exports = WdioObsidianServicePlugin;
