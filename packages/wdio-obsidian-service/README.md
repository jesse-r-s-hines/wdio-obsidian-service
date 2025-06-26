# WDIO Obsidian Service
[![NPM](https://img.shields.io/npm/v/wdio-obsidian-service)](https://www.npmjs.com/package/wdio-obsidian-service)

`wdio-obsidian-service` lets you test [Obsidian](https://obsidian.md) plugins end-to-end using [WebdriverIO](https://webdriver.io). The service can:
- Download and install Obsidian
- Test your plugin on multiple Obsidian app versions and installer/Electron versions
- Download Chromedriver matching the Obsidian electron version
- Sandbox Obsidian so tests don't interfere with your system Obsidian installation or each other
- Run tests in parallel
- Open and switch between vaults during your tests
- Provide helper functions for common testing tasks
- Run tests in GitHub CI

## Installation and Setup

If you want to get going quickly, you can use the [wdio-obsidian-service sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin) as a template which has everything already set up to run end-to-end tests, including GitHub CI workflows.

See also: [WebdriverIO | Getting Started](https://webdriver.io/docs/gettingstarted).

To set up wdio-obsidian-service run the WebdriverIO Starter Toolkit:
```bash
npm init wdio@latest .
```
Leave all options as default (including `E2E Testing - of Web or Mobile Applications`).

Delete the generated `pageobjects` dir for now, or replace it with a stub for later.

Then install `wdio-obsidian-service` and other deps:
```bash
npm install --save-dev wdio-obsidian-service wdio-obsidian-reporter mocha @types/mocha
```

Add this to `tsconfig.json`:
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

Set up your `wdio.conf.ts` like so:
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

And create a test file `test/specs/test.e2e.ts` with something like:
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

`wdio-obsidian-service` has a few helper functions that can be useful in your wdio conf, such as `obsidianBetaAvailable` which checks if there's a current Obsidian beta and you have the credentials to download it. E.g. to test on your plugin on Obsidian `latest`, `latest-beta`, and your `minAppVersion` use:
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

You can see the [sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin) for more examples of how to write your wdio.conf and e2e tests.

### Platform Support

`wdio-obsidian-service` works for Obsidian desktop on Windows, Linux, and MacOS.

Windows firewall will sometimes complain about NodeJS, you can just cancel the popup it makes.

### Test Frameworks

WebdriverIO can run tests using [Mocha](https://mochajs.org), [Jasmine](https://jasmine.github.io), and [Cucumber](https://cucumber.io/). Mocha is the easiest to set up and is used in all the wdio-obsidian-service examples. Mocha can also run your unit tests, typically with the addition of an assertion library like [Chai](https://www.chaijs.com). You can't run WebdriverIO using [Jest](https://jestjs.io), but if you already have Jest unit tests (or just prefer Jest) you can easily continue using Jest for your unit tests and Mocha just for your e2e tests. The built-in WebdriverIO [expect](https://webdriver.io/docs/api/expect-webdriverio) is very similar to Jest matchers, so should be familiar to use.

## Usage

### Obsidian App vs Installer Versions

Obsidian is distributed in two parts, the "installer" which is the executable containing Electron, and the "app" which is a bundle of JavaScript containing the Obsidian code. Obsidian's self-update system only updates the app JS bundle, and not the base installer/Electron version. This makes Obsidian's auto-update fast as it only needs to download a few MiB of JS instead of all of Electron. But, it means different users with the same Obsidian app version may be running on different versions of Electron, which can cause subtle differences in plugin behavior. You can specify both `appVersion` and `installerVersion` in your `wdio.conf.mts` capabilities section.

To set the app version use `browserVersion` or `'wdio:obsidianOptions'.appVersion`. It can be set to one of:
- a specific version string like "1.7.7"
- "latest": run the latest non-beta Obsidian version
- "latest-beta": run the latest beta Obsidian version (or latest is there is no current beta)
    - To download Obsidian beta versions you'll need to have an Obsidian account with Catalyst and set the `OBSIDIAN_USERNAME` and `OBSIDIAN_PASSWORD` environment variables. 2FA needs to be disabled.
- "earliest": run the `minAppVersion` set in your plugin's `manifest.json`

To set the installer version use `'wdio:obsidianOptions'.installerVersion`. It can be set to one of:
- a specific version string like "1.7.7"
- "latest": run the latest Obsidian installer compatible with `appVersion`
- "earliest": run the oldest Obsidian installer compatible with `appVersion`

You can see more configuration options for the capabilities [here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/ObsidianCapabilityOptions.html).

### Opening and Switching between Vaults

If all your tests use the same vault, you can set the vault in the `wdio:obsidianOptions` capabilities section. If you need to switch between vaults during your test you can use the `reloadObsidian` or `resetVault` functions. These can also be useful for resetting state between tests (such as in Mocha `before` and `beforeEach` hooks). 

`browser.reloadObsidian` reboots Obsidian with a fresh copy of the vault. This will clear all state, but is quite slow. E.g.
```ts
it("test the thing", async function() {
    await browser.reloadObsidian({vault: "test/vaults/simple"});
    ...
})
```

`obsidianPage.resetVault` is a faster alternative to `reloadObsidian`. It updates the vault by modifying files in place without reloading Obsidian. It only updates vault files, not Obsidian configuration etc, but in many cases that's all you need. You'll often want to put this in a `beforeEach`.
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

API docs, including all configuration options and helper functions, are available [here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/README.html).

Some key bits:
- See [ObsidianCapabilityOptions](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/ObsidianCapabilityOptions.html) for all the options you can pass to `wdio:obsidianOptions` in your wdio.conf
- See [ObsidianBrowserCommands](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/ObsidianBrowserCommands.html) and [ObsidianPage](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/ObsidianPage.html) for various useful helper functions

And of course, see also [WDIO's documentation](https://webdriver.io/docs/gettingstarted) and the [many browser commands it provides](https://webdriver.io/docs/api/browser).

### GitHub CI Workflows
The sample plugin has workflows set up to release and test your plugin, which you can see [here](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin#github-workflows).

### obsidian-launcher CLI
`wdio-obsidian-service` depends on [`obsidian-launcher`](../../packages/obsidian-launcher/README.md) so the `obsidian-launcher` CLI is also available, with some commands for launching different Obsidian versions. CLI docs available [here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/obsidian-launcher/README.html#cli).
