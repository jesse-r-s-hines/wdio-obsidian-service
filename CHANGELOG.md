# Changelog

## 1.0.0

## 1.0.1

## 1.0.2
- Doc fixes

## 1.0.3

## 1.1.0
- Support hidden files in `resetVault`
- Update docs

## 1.1.1

## 1.2.0
- misc documentation updates
- remove broken `gautamkrishnar/keepalive-workflow` from wdio-obsidian-service-sample-plugin workflow example

## 1.2.1
- Fix bug with executeObsidian `plugins` argument getting out of sync

## 1.3.0
- Fix obsidian-launcher CLI "SUID" issue on linux
- Support passing extra arguments to Obsidian in the obsidian-launcher cli

## 1.3.1
- Fix obsidian-launcher cli not respecting `--installer` argument

## 1.3.2

## 1.3.3
- Fix error on latest wdio version

## 2.0.0
Now supports mobile testing!

You can choose from two approaches for testing your plugin on mobile. You can use `emulateMobile` to easily emulate the mobile UI on the electron desktop app. Or you can set up Android Studio and a Android Virtual Device to test your plugin on the real Obsidian Android app. See [Platform Support](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/README.html#platform-support) for more info on how to set up mobile testing.

### Other changes
- Improve CI workflows in sample plugin
    - Set up a window manager to fix some intermittent failures that only occurred in the CI tests
- Add more helper methods for file manipulation in vaults
- Add `startWdioSession` to launch wdio in [standalone mode](https://webdriver.io/docs/setuptypes/#standalone-mode), so you can use it for scripting scenarios
- Improve handling of Obsidian Insiders login for beta versions, now `obsidian-launcher` will prompt for credentials and optionally cache them.
- Remove 7zip requirement
- Add `parseObsidianVersions` helper
- Improve support for ARM architecture
- Make `obsidianPage.openFile` set tab to active.
- Documentation improvements, better error handling, performance improvements and more

### Breaking changes
- Made `obsidianPage.getVaultPath`, `browser.getObsidianVersion`, `browser.getObsidianInstallerVersion`, and `browser.getObsidianPage` synchronous
- `getVaultPath` will now throw instead of returning undefined if no vault is open
- vault, plugin and theme paths in wdio config are now resolved relative to `wdio.conf.mts`, to match behavior of other paths in wdio conf.
- Rename `ObsidianLauncher.resolveVersions` to `resolveVersion`

## 2.0.1
- Fix peer dependency conflict

## 2.0.2
- Fix some intermittent errors in reloadObsidian when using Appium
- Documentation fixes

## 2.1.0
- Performance improvements to mobile Appium testing
    - Now supports using the `appium:noReset` option to avoid relaunching Obsidian before every test
    - Improved performance of transfering vault to the AVD
- Expand `obsidian-launcher download` command to download more asset types
- Support installing specific theme versions
- Fix sample CI workflow's window-manager setup (again)
- Fix ObsidianLauncher ignoring the platform and arch arguments
