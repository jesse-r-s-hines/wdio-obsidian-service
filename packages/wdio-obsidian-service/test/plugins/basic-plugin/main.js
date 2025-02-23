const { Plugin } = require('obsidian');

class BasicPlugin extends Plugin {
    async onload() {
        const statusBarItemEl = this.addStatusBarItem();
        statusBarItemEl.addClass("basic-plugin-status-bar-item")
        statusBarItemEl.setText('Test plugin loaded!');

        this.addCommand({
            id: 'do-the-thing',
            name: 'Do the thing',
            callback: () => {
                window.doTheThingCalled = (window.doTheThingCalled ?? 0) + 1;
            },
        });
    };
}

module.exports = BasicPlugin;
