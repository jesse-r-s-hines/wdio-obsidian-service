# Obsidian Launcher [![](https://img.shields.io/npm/v/obsidian-launcher)](https://www.npmjs.com/package/obsidian-launcher)

`obsidian-launcher` is a package for downloading and launching different versions of [Obsidian](https://obsidian.md) for testing Obsidian plugins. It can download and launch different versions of Obsidian, install plugins and themes into Obsidian vaults, and launch sandboxed Obsidian instances with isolated user configuration directories. You can use it as either a JavaScript package or as a command line interface.

The primary use case for this package is to allow [wdio-obsidian-service](../wdio-obsidian-service/README.md) to automatically download Obsidian when testing plugins with WebdriverIO. However, it can also be used as a stand-alone package if you want to use the CLI to compare Obsidian versions during plugin development.

## Example Usage
You can run the CLI via `npx`, e.g.:
```bash
npx obsidian-launcher watch --version 1.8.10 --copy -p . test/vault
```
This will download and launch Obsidian 1.8.10 with a sandboxed configuration directory so you don't need to worry about it interfering with your system Obsidian installation. You can even launch multiple different versions of Obsidian side-by-side. See [below](#cli) for CLI docs.

To use the JavaScript API, use the `ObsidianLauncher` class, e.g.:
```js
import ObsidianLauncher from "obsidian-launcher"
const launcher = new ObsidianLauncher();
const {proc} = await launcher.launch({
    appVersion: "1.8.10",
    vault: "path/to/my/vault",
    copy: true, // open a copy of the vault in Obsidian
    plugins: [
        "path/to/my/plugin", // install a local plugin
        {id: "dataview"}, // install a community plugin
    ],
})
```

## Obsidian App vs Installer Versions
Obsidian Desktop is distributed in two parts, the "installer" which is the executable containing Electron, and the "app" which is a bundle of JavaScript containing the Obsidian code. Obsidian's self-update system only updates the app JS bundle, and not the base installer/Electron version. This makes Obsidian's auto-update fast as it only needs to download a few MiB of JS instead of all of Electron. But, it means different users with the same Obsidian app version may be running on different versions of Electron, which can cause subtle differences in plugin behavior. Most ObsidianLauncher methods take both an `appVersion` and an `installerVersion` parameter, allowing you to test the same Obsidian app version on different versions of Electron.

`appVersion` can be set to one of:
- a specific version string like "1.7.7"
- "latest": run the latest non-beta Obsidian version
- "latest-beta": run the latest beta Obsidian version (or latest is there is no current beta)
    - To download Obsidian beta versions you'll need to have an Obsidian Insiders account
- "earliest": run the `minAppVersion` set in your plugin's `manifest.json`

`installerVersion` can be set to one of:
- a specific version string like "1.7.7"
- "latest": run the latest Obsidian installer compatible with `appVersion`
- "earliest": run the oldest Obsidian installer compatible with `appVersion`

### Platform Support
`obsidian-launcher` works for Obsidian Desktop on Windows, Linux, and MacOS.

Windows firewall will sometimes complain about NodeJS on launch, you can just cancel the popup it makes.

## API Docs
API docs for the package are available [here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/obsidian-launcher/README.html).

## CLI
```bash
npx obsidian-launcher [subcommand] ...
```

### Plugin and Theme format
Several commands can take a list of plugins and themes to install. You can specify the `--plugin` and `--theme` arguments multiple times to install multiple plugins/themes. The format should be one of:
- `<path>`: Path to a local plugin/theme to install
- `repo:<github-repo>`: GitHub repo of the plugin/theme to install, e.g. `repo:SilentVoid13/Templater`
- `id:<community-id>`: For plugins, id of a community plugin, e.g. `id:templater-obsidian`
- `name:<community-name>`: For themes, name of a community theme, e.g. `name:Minimal`

You can install a specific version of a plugin with `-p id:myplugin=1.2.3`.

### launch
Download and launch Obsidian, opening the specified vault.

The Obsidian instance will have a sandboxed configuration directory. You can use this command to compare plugin behavior on different versions of Obsidian without messing with your system installation of Obsidian.

You can pass arguments through to the Obsidian executable using `--`:
```bash
npx obsidian-launcher launch ./vault -- --remote-debugging-port=9222
```

Arguments:
- `vault`: Vault to open

Options:
- `-v, --version <version>`: Obsidian app version to run (default: "latest")
- `-i, --installer <version>`: Obsidian installer version to run (default: "earliest")
- `-p, --plugin <plugin>`: Plugin(s) to install
- `-t, --theme <plugin>`: Theme(s) to install
- `--copy`: Copy the vault first
- `-c, --cache <cache>`: Directory to use as the download cache (default: OBSIDIAN_CACHE env var or ".obsidian-cache")

### watch
Downloads Obsidian and opens a vault, then watches for changes to plugins and themes.

Takes the same arguments as the `launch` command but watches for changes to any local plugins or themes and updates the vault. Automatically installs `pjeby/hot-reload` so plugins will hot reload as they are updated.

Arguments:
- `vault`: Vault to open

Options:
- `-v, --version <version>`: Obsidian app version to run (default: "latest")
- `-i, --installer <version>`: Obsidian installer version to run (default: "latest")
- `-p, --plugin <plugin>`: Plugin(s) to install
- `-t, --theme <plugin>`: Theme to install
- `--copy`: Copy the vault first
- `-c, --cache <cache>`: Directory to use as the download cache (default: OBSIDIAN_CACHE env var or ".obsidian-cache")

### install
Install plugins and themes into an Obsidian vault.

Arguments:
- `vault`: Vault to install into

Options:
- `-p, --plugin <plugin>`: Plugin(s) to install
- `-t, --theme <plugin>`: Theme(s) to install.
- `-c, --cache <cache>`: Directory to use as the download cache (default: OBSIDIAN_CACHE env var or ".obsidian-cache")

### download
Download Obsidian to the cache.

Pre-download Obsidian to the cache. Pass --type to select what variant to download, which can be one of:
- app: Download the desktop app JS bundle
- installer: Download the desktop installer
- desktop: Download both the desktop app and installer (the default)
- apk: Download the mobile app APK file

Options:
- `--type <version>`: Type to download (default: "desktop")
- `-v, --version <version>`: Obsidian version (default: "latest")
- `-i, --installer <version>`: Obsidian installer version (default: "earliest")
- `--platform <platform>`: Platform of the installer, one of linux, win32, darwin. (default: system platform)
- `--arch <arch>`: Architecture of the installer, one of arm64, ia32, x64. (default: system arch)
- `-c, --cache <cache>`: Directory to use as the download cache (default: OBSIDIAN_CACHE env var or ".obsidian-cache")

