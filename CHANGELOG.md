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

## 2.1.1
- Fix octokit dependency breaking package on older moduleResolution modes

## 2.1.2
- Documentation fixes
- Fix race-condition in .obsidian-cache downloads
- More flexible parsing of plugin/theme versions in obsidian-launcher CLI

## 2.1.3
- Add documentation for MacOS workaround

## 2.1.4
- Fix MacOS security settings blocking the downloaded Obsidian executables

## 2.1.5
- More fixes on MacOS, clear the `com.apple.quarantine` attribute on downloaded Obsidian executables

## 2.1.6
- Minor documentation updates

## 2.2.0
- Allow running "incompatible" app and installer versions with just a warning
- Fix vault not being opened on old Obsidian versions
- Fix incorrect minInstallerVersion
    - When using "earliest" installer settings, it would pick installers that were too old for the specified Obsidian app version. Now it checks for installer compatibility correctly
- Add ObsidianPage.read and ObsidianPage.readBinary helper methods
- Add ObsidianLauncher.login method

## 2.2.1
Fix incompatibility with appium 3

Note, to use appium 3 you'll need to update your wdio.mobile.conf.ts appium service config to
```js
["appium", {
    args: { allowInsecure: "*:chromedriver_autodownload,*:adb_shell" },
}],
```
If you encounter errors, try wiping and recreating package-lock.json to make sure you have the latest versions of
wdio, appium, and the appium drivers.

## 2.3.0
Support Obsidian CLI in wdio tests!

### Changes
- Add `ObsidianPage.runObsidianCli` to run the Obsidian CLI during WDIO tests
- Add `obsidian-launcher cli` command and `ObsidianLauncher.getObsidianCli` on sandboxed Obsidian instances launched via `obsidian-launcher`

### Bug Fixes
- fix some intermittent errors on Android
- fix obsidian-launcher download command ignoring installer arg
- fix ObsidianPage.getPlatform result on old Obsidian versions

## 2.3.1
- Fix changelog and release tag

## 2.3.2
- Documentation updates

## 2.3.3
- Fix `obsidian-launcher cli` command and `runObsidianCli` on Windows
    - The TUI still doesn't work properly on Windows via `obsidian-launcher cli` but running commands directly does.

## 2.4.0
- Fix hang when installing via PNPM (see https://github.com/pnpm/pnpm/issues/10718#issuecomment-4054773598)
- Fix `ObsidianPage.runObsidianCli` on `1.12.5`
    - There's still issues using the `obsidian-launcher cli` command on 1.12.5, but `ObsidianPage.runObsidianCli` will work in wdio tests

## 3.0.0
- Add `copy: false` option to avoid copying large vaults in tests
- Breaking change: Remove broken `ObsidianLauncher.getObsidianCli` method and `obsidian-launcher cli` command
    - These no longer work as of Obsidian 1.12.5.
    - However the default Obsidian CLI command will work with Obsidian instances launched via `obsidian-launcher` as long as you only have one Obsidian instance up at a time.
