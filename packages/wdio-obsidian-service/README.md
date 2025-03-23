# WDIO Obsidian Service

`wdio-obsidian-service` lets you test [Obsidian](https://obsidian.md) plugins end-to-end using
[WebdriverIO](https://webdriver.io). The service will handle:
- Downloading and installing Obsidian
- Testing your plugin on different Obsidian app versions and installer/electron versions
- Downloading Chromedriver matching the Obsidian electron version
- Sandboxing Obsidian so tests don't interfere with your system Obsidian installation
- Provides helper functions for common testing tasks

## Installation and Setup
If you want to get going quickly, you can checkout the
[wdio-obsidian-service sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin) which has
all the setup you need to build and e2e test Obsidian plugins, including GitHub CI workflows.

To setup wdio-obsidian-service manually, run the WebdriverIO Starter Toolkit:
```bash
npm init wdio@latest .
```
Leave all options as default (including `E2E Testing - of Web or Mobile Applications`).
Delete the generated `pageobjects` dir for now, or replace it with a stub for later.

Then install `wdio-obsidian-service` and other deps:
```bash
npm install --save-dev wdio-obsidian-service wdio-obsidian-reporter mocha @types/mocha chai @types/chai @types/node
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

Setup `wdio.conf.ts`  like so:
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
        browserVersion: "latest",
        'wdio:obsidianOptions': {
            installerVersion: "earliest",
            plugins: ["."],
        },
    }],

    framework: 'mocha',
    services: ["obsidian"],
    // You can use any wdio reporter, but by default they show the Chromium version instead of the
    // Obsidian version. obsidian-reporter is just a wrapper around spec-reporter that shows the
    // Obsidian version.
    reporters: ['obsidian'],

    mochaOpts: {
        ui: 'bdd',
        timeout: 60000,
        // You can set mocha settings like "retry and "bail"
    },

    cacheDir: path.resolve(".obsidian-cache"),

    logLevel: "warn",
}
```

Create a file `test/specs/test.e2e.ts` with something like:
```ts
import { browser } from '@wdio/globals'
import { expect } from 'chai';

describe('Test my plugin', function() {
    before(async function() {
        // You can create test vaults and open them with reloadObsidian
        // Alternatively if all your tests use the same vault, you can
        // set the default vault in the wdio.conf.ts.
        await browser.reloadObsidian({vault: "./test/vaults/simple"});
    })
    it('test command open-sample-modal-simple', async () => {
        await browser.executeObsidianCommand("sample-plugin:open-sample-modal-simple");
        expect(await browser.$(".modal-container .modal-content").isExisting()).to.equal(true);
        expect(await browser.$(".modal-container .modal-content").getText()).to.equal("Woah!");
    })
})
```

You can see the [sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin) for more
examples of how to write `wdio.conf.ts` and your e2e tests.

See also: [WebdriverIO | Getting Started](https://webdriver.io/docs/gettingstarted).

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

You can specify both `appVersion` and `installerVersion` in your `wdio.conf.ts` capabilities section.

To set the app version use `browserVersion` or `'wdio:obsidianOptions'.appVersion`. It can be set to one of:
- a specific version string like "1.7.7"
- "latest": run the current latest non-beta Obsidian version
- "latest-beta": run the current latest beta Obsidian version (or latest is there is no current beta)
    - To download Obsidian beta versions you'll need to have an Obsidian account with Catalyst and set the 
      `OBSIDIAN_USERNAME` and `OBSIDIAN_PASSWORD` environment variables. 2FA needs to be disabled.
- "earliest": run the `minAppVersion` set in your plugin's `manifest.json`

To set the installer version use `'wdio:obsidianOptions'.appVersioninstallerVersion`. It can be set to one of:
- a specific version string like "1.7.7"
- "latest": run the latest Obsidian installer compatible with `appVersion`
- "earliest": run the oldest Obsidian installer compatible with `appVersion`

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
[here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/modules/wdio-obsidian-service.html).

### GitHub CI Workflows
The sample plugin has workflows already setup to release and test your plugin, which you can see
[here](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin/tree/main/.github/workflows).

### `obsidian-launcher` CLI
`wdio-obsidian-service` depends on `obsidian-launcher` so the `obsidian-launcher` CLI is also available, with some 
commands for launching different Obsidian versions. CLI docs available
[here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/modules/obsidian-launcher.html#cli).
