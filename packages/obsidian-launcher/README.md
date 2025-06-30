# Obsidian Launcher [![NPM](https://img.shields.io/npm/v/obsidian-launcher)](https://www.npmjs.com/package/obsidian-launcher)

`obsidian-launcher` is a package for downloading and launching different versions of [Obsidian](https://obsidian.md) for testing and development of Obsidian plugins. It can download Obsidian, install plugins and themes into Obsidian vaults, and launch sandboxed Obsidian instances with isolated user configuration directories. You can use it either as a JavaScript package or as a command line interface.

The primary use case for this package is to allow [wdio-obsidian-service](../wdio-obsidian-service/README.md) to download Obsidian when testing Obsidian plugins with WebdriverIO. However, it can also be used as a stand-alone package, for instance if you want to test plugins with a different testing framework, or want to use the CLI during development.

## Example Usage
The default export of the package is the `ObsidianLauncher` class, which can be used like so:
```js
const launcher = new ObsidianLauncher();
const {proc} = await launcher.launch({
    appVersion: "1.7.7",
    vault: "path/to/my/vault",
    copy: true, // open a copy of the vault in Obsidian
    plugins: [
        "path/to/my/plugin", // install a local plugin
        {id: "dataview"}, // install a community plugin
    ],
})
```
This will download and launch Obsidian 1.7.7 with a sandboxed configuration directory so you don't need to worry about it interfering with your system Obsidian installation.

## Obsidian App vs Installer Versions
Obsidian is distributed in two parts, the "installer" which is the executable containing Electron, and the "app" which is a bundle of JavaScript containing the Obsidian code. Obsidian's self-update system only updates the app JS bundle, and not the base installer/Electron version. This makes Obsidian's auto-update fast as it only needs to download a few MiB of JS instead of all of Electron. But, it means different users with the same Obsidian app version may be running on different versions of Electron, which can cause subtle differences in plugin behavior. Most ObsidianLauncher methods take both an `appVersion` and an `installerVersion` parameter, allowing you to test the same Obsidian app version on different versions of Electron.

`appVersion` can be set to one of:
- a specific version string like "1.7.7"
- "latest": run the latest non-beta Obsidian version
- "latest-beta": run the latest beta Obsidian version (or latest is there is no current beta)
    - To download Obsidian beta versions you'll need to have an Obsidian account with Catalyst and set the `OBSIDIAN_USERNAME` and `OBSIDIAN_PASSWORD` environment variables. 2FA needs to be disabled.
- "earliest": run the `minAppVersion` set in your plugin's `manifest.json`

`installerVersion` can be set to one of:
- a specific version string like "1.7.7"
- "latest": run the latest Obsidian installer compatible with `appVersion`
- "earliest": run the oldest Obsidian installer compatible with `appVersion`

### Platform Support
`obsidian-launcher` works for Obsidian desktop on Windows, Linux, and MacOS.

Windows firewall will sometimes complain about NodeJS on launch, you can just cancel the popup it makes.

## API Docs
API docs for the package are available [here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/obsidian-launcher/README.html).

## CLI
`obsidian-launcher` also provides a CLI interface which can be used via `npx`
```bash
npx obsidian-launcher [subcommand] ...
```

### Example
```bash
npx obsidian-launcher watch --version 1.8.10 --copy -p . test/vault
```

### Plugin and Theme format
Several commands can take a list of plugins and themes to install. You can specify the `--plugin` and `--theme` arguments multiple times to install multiple plugins/themes. The format should be one of:
- `<path>`: Path to a local plugin/theme to install
- `repo:<github-repo>`: GitHub repo of the plugin/theme to install, e.g. `repo:SilentVoid13/Templater`
- `id:<community-id>`: For plugins, id of a community plugin, e.g. `id:templater-obsidian`
- `name:<community-name>`: For themes, name of a community theme, e.g. `name:Minimal`

### launch
Download and launch Obsidian, opening the specified vault.

The Obsidian instance will have a sandboxed configuration directory. You can use this option to easily compare plugin behavior on different versions of Obsidian without messing with your system installation of Obsidian.

You can pass arguments through to the Obsidian executable using `--` like so:
```bash
npx obsidian-launcher ./vault -- --remote-debugging-port=9222
```

Arguments:
- `vault`: Vault to open

Options:
- `-c, --cache <cache>`: Directory to use as the download cache
- `-v, --version <version>`: Obsidian app version to run (default: "latest")
- `-i, --installer <version>`: Obsidian installer version to run (default: "latest")
- `-p, --plugin <plugin>`: Plugin(s) to install
- `-t, --theme <plugin>`: Theme(s) to install
- `--copy`: Copy the vault first

### watch
Downloads Obsidian and opens a vault, then watches for changes to plugins and themes.

Takes the same arguments as the `launch` command but watches for changes to any local plugins or themes and updates the vault. Automatically installs `pjeby/hot-reload` so plugins will hot reload as they are updated.

Arguments:
- `vault`: Vault to open

Options:
- `-c, --cache <cache>`: Directory to use as the download cache
- `-v, --version <version>`: Obsidian app version to run (default: "latest")
- `-i, --installer <version>`: Obsidian installer version to run (default: "latest")
- `-p, --plugin <plugin>`: Plugin(s) to install
- `-t, --theme <plugin>`: Theme to install
- `--copy`: Copy the vault first

### download
Download Obsidian to the cache without launching.

Options:
- `-c, --cache <cache>`: Directory to use as the download cache
- `-v, --version <version>`: Obsidian app version to download (default: "latest")
- `-i, --installer <version>`: Obsidian installer version to download (default: "latest")

### install
Install plugins and themes into an Obsidian vault.

Arguments:
- `vault`: Vault to install into

Options:
- `-c, --cache <cache>`: Directory to use as the download cache
- `-p, --plugin <plugin>`: Plugin(s) to install
- `-t, --theme <plugin>`: Theme(s) to install.
