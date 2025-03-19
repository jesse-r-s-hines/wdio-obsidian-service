# obsidian-launcher

`obsidian-launcher` is a package for downloading and launching different versions of [Obsidian](https://obsidian.md)
during testing and development of Obsidian plugins. It can download Obsidian, install plugins and themes into Obsidian
vaults, and launch sandboxed instances Obsidian with isolated user configuration directories. You can use it either as
a JavaScript package or as a command line interface.

The primary use case for this package is downloading and launching Obsidian for testing Obsidian plugins
in WebdriverIO with
[wdio-obsidian-service](https://jesse-r-s-hines.github.io/wdio-obsidian-service/modules/obsidian-launcher.html). 
However, it can also be used as a stand-alone package, for instance if you want to test plugins with a different
 testing framework, or just want to use the provided CLI.

## Example Usage
The default export of the package is the `ObsidianLauncher` class, which can be used like so:
```js
const launcher = new ObsidianLauncher();
const {proc} = await launcher.launch({
    appVersion: "1.7.7",
    vault: "path/to/my/vault",
    copy: true, // copy the vault before installing plugins and opening in Obsidian
    plugins: [
        "path/to/my/plugin", // install a local plugin
        {id: "dataview"}, // install a community plugin
    ],
})
```
This will download and launch Obsidian 1.7.7 with a sandboxed configuration directory so you don't need to worry about
it interfering with your system Obsidian installation.

## API Docs
API docs for the package are available [here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/modules/obsidian-launcher.html).


## CLI
`obsidian-launcher` also provides a CLI interface which can be used via `npx`
```bash
npx obsidian-launcher [subcommand] ...
```

Available commands:

### download
Download Obsidian to the cache without launching.

```text
Options:
  -c, --cache <cache>        Directory to use as the download cache
  -v, --version <version>    Obsidian version to run
                             (default: "latest")
  -i, --installer <version>  Obsidian installer version to run
                             (default: "latest")
```

### install
Install plugins and themes into an Obsidian vault.

```text
Arguments:
  vault                  Vault to install into

Options:
  -c, --cache <cache>    Directory to use as the download cache
  -p, --plugin <plugin>  Plugin to install. Format one of:
                           - "<path>"
                           - "repo:<github-repo>"
                           - "id:<community-id>"
                         Can be repeated.
  -t, --theme <plugin>   Theme to install. Format one of:
                           - "<path>"
                           - "repo:<github-repo>"
                           - "name:<community-name>".
                         Can be repeated but only last will be enabled.
```

### launch
Download and launch Obsidian, opening the specified vault. The Obsidian instance will have a sandboxed configuration
directory.

You can use this option to easily compare plugin behavior on different versions of Obsidian without messing with your
system installation of Obsidian.

```text
Arguments:
  vault                      Vault to open

Options:
  -c, --cache <cache>        Directory to use as the download cache
  -v, --version <version>    Obsidian version to run
                             (default: "latest")
  -i, --installer <version>  Obsidian installer version to run
                             (default: "latest")
  -p, --plugin <plugin>      Plugin to install. Format one of:
                               - "<path>"
                               - "repo:<github-repo>"
                               - "id:<community-id>".
                             Can be repeated.
  -t, --theme <plugin>       Theme to install. Format one of:
                               - "<path>"
                               - "repo:<github-repo>"
                               - "name:<community-name>".
                             Can be repeated but only last will be enabled.
  --copy                     Copy the vault first
```

### watch
Downloads Obsidian and opens a vault, then watches for changes to plugins and themes.

Takes the same arguments as the `launch` command but watches for changes to any local plugins or themes and updates the
the vault. Automatically installs `pjeby/hot-reload` so plugins will hot reload as they are updated.

```text
Arguments:
  vault                      Vault to open

Options:
  -c, --cache <cache>        Directory to use as the download cache
  -v, --version <version>    Obsidian version to run
                             (default: "latest")
  -i, --installer <version>  Obsidian installer version to run
                             (default: "latest")
  -p, --plugin <plugin>      Plugin to install. Format one of:
                               - "<path>"
                               - "repo:<github-repo>"
                               - "id:<community-id>".
                             Can be repeated.
  -t, --theme <plugin>       Theme to install. Format one of:
                               - "<path>"
                               - "repo:<github-repo>"
                               - "name:<community-name>".
                             Can be repeated but only last will be enabled
  --copy                     Copy the vault first
```
