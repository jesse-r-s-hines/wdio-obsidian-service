[![NPM](https://img.shields.io/npm/v/wdio-obsidian-service)](https://www.npmjs.com/package/wdio-obsidian-service)
# WDIO Obsidian Service

`wdio-obsidian-service` lets you test [Obsidian](https://obsidian.md) plugins end-to-end using
[WebdriverIO](https://webdriver.io). The service handles:
- Downloading and installing Obsidian
- Testing your plugin on different Obsidian app versions and installer/electron versions
- Opening and switching between test vaults during your tests
- Downloading Chromedriver matching the Obsidian electron version
- Sandboxing Obsidian so tests don't interfere with your system Obsidian installation or each other
- Running tests in parallel
- Provides helper functions for common testing tasks

## Installation and Setup
If you want to get going quickly, you can use the
[wdio-obsidian-service sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin) which has
all the setup you need to build and end-to-end test Obsidian plugins, including GitHub CI workflows.

See also: [WebdriverIO | Getting Started](https://webdriver.io/docs/gettingstarted).

To setup wdio-obsidian-service manually, run the WebdriverIO Starter Toolkit:
```bash
npm init wdio@latest .
```
Leave all options as default (including `E2E Testing - of Web or Mobile Applications`).
Delete the generated `pageobjects` dir for now, or replace it with a stub for later.

Then install `wdio-obsidian-service` and other deps:
```bash
npm install --save-dev wdio-obsidian-service wdio-obsidian-reporter mocha @types/mocha @types/node
```

And add this `tsconfig.json`:
```json
{
  "compilerOptions": {
    // ...
    "types": [
      "@wdio/globals/types",
      "@wdio/mocha-framework",
      "wdio-obsidian-service"
    ],
  }
}
```

Setup your `wdio.conf.ts` like so:
```ts
import * as path from "path"

export const config: WebdriverIO.Config = {
    runner: 'local',

    specs: [
        './test/specs/**/*.e2e.ts'
    ],

    // How many instances of Obsidian should be launched in parallel
    maxInstances: 4,

    capabilities: [{
        browserName: 'obsidian',
        // obsidian app version to download
        browserVersion: "latest",
        'wdio:obsidianOptions': {
            // obsidian installer version
            // (see "Obsidian App vs Installer Versions" below)
            installerVersion: "earliest",
            plugins: ["."],
            // If you need to switch between multiple vaults, you can omit
            // this and use reloadObsidian to open vaults during the tests
            vault: "test/vaults/simple",
        },
    }],

    framework: 'mocha',
    services: ["obsidian"],
    // You can use any wdio reporter, but they show the Chromium version
    // instead of the Obsidian version. obsidian reporter just wraps
    // spec reporter to show the Obsidian version.
    reporters: ['obsidian'],

    mochaOpts: {
        ui: 'bdd',
        timeout: 60000,
        // You can set mocha settings like "retry" and "bail"
    },

    cacheDir: path.resolve(".obsidian-cache"),

    logLevel: "warn",
}
```

Create a file `test/specs/test.e2e.ts` with something like:
```ts
import { browser } from '@wdio/globals'

describe('Test my plugin', function() {
    before(async function() {
        // You can create test vaults and open them with reloadObsidian
        // Alternatively if all your tests use the same vault, you can
        // set the default vault in the wdio.conf.ts.
        await browser.reloadObsidian({vault: "./test/vaults/simple"});
    })
    it('test command open-sample-modal-simple', async () => {
        await browser.executeObsidianCommand(
            "sample-plugin:open-sample-modal-simple",
        );
        const modalEl = browser.$(".modal-container .modal-content");
        await expect(modalEl).toExist();
        await expect(modalEl).toHaveText("Woah!");
    })
})
```

`wdio-obsidian-service` has a few helper functions that can be useful in your wdio conf, such as `obsidianBetaAvailable`
which checks if there's a current Obsidian beta and you have the credentials to download it. E.g. to test your
`minAppVersion`, `latest`, and `latest-beta` if it's available use:
```ts
import { obsidianBetaAvailable } from "wdio-obsidian-service";
const cacheDir = path.resolve(".obsidian-cache");

const versions: [string, string][] = [
    ["earliest", "earliest"],
    ["latest", "latest"],
];
if (await obsidianBetaAvailable(cacheDir)) {
    versions.push(["latest-beta", "latest"]);
}

export const config: WebdriverIO.Config = {
    cacheDir: cacheDir,

    capabilities: versions.map(([appVersion, installerVersion]) => ({
        browserName: 'obsidian',
        browserVersion: appVersion,
        'wdio:obsidianOptions': {
            installerVersion: installerVersion,
            plugins: ["."],
        },
    })),

    // ...
}
```
Note, to use top-level await you'll need to rename `wdio.conf.ts` to `wdio.conf.mts` so it's loaded as an ESM module.

You can see the [sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin) for more
examples of how to write your wdio conf and e2e tests.

### Platform Support
`wdio-obsidian-service` works on Windows, Linux, and MacOS.

On Windows, you'll need to install [7zip](https://www.7-zip.org) and add it to the PATH so the service can extract the
Obsidian installer. Windows firewall will sometimes complain about NodeJS, you can just cancel the popup it makes.

Currently `wdio-obsidian-service` only works for Obsidian Desktop. Testing Obsidian Mobile may be added in the future
using WDIO + Appium.

## Usage

### Obsidian App vs Installer Versions
Obsidian is distributed in two parts, the "installer" which is the executable containing Electron, and the "app" which
is a bundle of JavaScript containing the Obsidian code. Obsidian's self-update system only updates the app JS bundle,
and not the base installer/Electron version. This makes Obsidian's auto-update fast as it only needs to download a few
MiB of JS instead of all of Electron. But, it means different users with the same Obsidian app version may be running on
different versions of Electron, which can cause subtle differences in plugin behavior.

You can check your current Obsidian app and installer versions in the General settings tab.

You can specify both `appVersion` and `installerVersion` in your `wdio.conf.mts` capabilities section.

To set the app version use `browserVersion` or `'wdio:obsidianOptions'.appVersion`. It can be set to one of:
- a specific version string like "1.7.7"
- "latest": run the latest non-beta Obsidian version
- "latest-beta": run the latest beta Obsidian version (or latest is there is no current beta)
    - To download Obsidian beta versions you'll need to have an Obsidian account with Catalyst and set the 
      `OBSIDIAN_USERNAME` and `OBSIDIAN_PASSWORD` environment variables. 2FA needs to be disabled.
- "earliest": run the `minAppVersion` set in your plugin's `manifest.json`

To set the installer version use `'wdio:obsidianOptions'.installerVersion`. It can be set to one of:
- a specific version string like "1.7.7"
- "latest": run the latest Obsidian installer compatible with `appVersion`
- "earliest": run the oldest Obsidian installer compatible with `appVersion`

You can see more configuration options for the capabilities
[here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/ObsidianCapabilityOptions.html)

### Opening and Switching between Vaults
If all your tests use the same vault, you can set the vault in the `wdio:obsidianOptions` capabilities section. If you
want to switch between vaults you can use `reloadObsidian` or `resetVault` during your tests. These can also be useful
for reseting state between tests to avoid tests affecting each other (such as in Mocha `before` and `beforeEach` hooks).

`browser.reloadObsidian` completely reboots Obsidian with a fresh copy of the vault. This will clear all state, but is
quite slow so avoid calling it too often.
E.g.
```ts
it("test the thing", async function() {
    await browser.reloadObsidian({vault: "test/vaults/simple"});
    ...
})
```

`obsidianPage.resetVault` is a faster alternative to `reloadObsidian`. It resets vault files to their original state in
place without rebooting Obsidian. It only resets vault files, not Obsidian configuration etc, but in many cases that's
all you need. You'll often want to put this in a `beforeEach`.
```ts
import { obsidianPage } from 'wdio-obsidian-service';
it("test the thing", async function() {
    // reset state to the original state of the vault
    await obsidianPage.resetVault();
    ....
    // to copy in the files from a different vault
    await obsidianPage.resetVault("test/vaults/simple");
})
```

### API Docs
API docs, including all configuration options and helper functions, are available
[here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/README.html).

### GitHub CI Workflows
The sample plugin has workflows setup to release and test your plugin, which you can see
[here](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin#github-workflows).

### obsidian-launcher CLI
`wdio-obsidian-service` depends on `obsidian-launcher` so the `obsidian-launcher` CLI is also available, with some 
commands for launching different Obsidian versions. CLI docs available
[here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/obsidian-launcher/README.html#cli).
