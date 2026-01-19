# WDIO Obsidian Service [![](https://img.shields.io/npm/v/wdio-obsidian-service)](https://www.npmjs.com/package/wdio-obsidian-service)

Test your [Obsidian](https://obsidian.md) plugins end-to-end using [WebdriverIO](https://webdriver.io)!

WDIO Obsidian Service can:
- 📥 Download and test multiple versions of Obsidian
- 💻📱 Run tests on Windows, macOS, Linux, and Android
- 📦 Sandbox Obsidian so tests don't interfere with your system or each other
- 📂 Open and switch between vaults
- 🛠️ Provide helper functions for common testing tasks
- 🤖 Run tests in CI

## Installation and Setup

If you want to get going quickly, you can use the [wdio-obsidian-service sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin) as a template which has everything already set up to run end-to-end tests, including GitHub CI workflows.

See also: [WebdriverIO | Getting Started](https://webdriver.io/docs/gettingstarted).

To set up `wdio-obsidian-service` manually in an existing project, run the WebdriverIO Starter Toolkit:
```bash
npm init wdio@latest .
```
Leave all options as default (including `E2E Testing - of Web or Mobile Applications`).

Delete the generated `test/pageobjects` dir for now, or replace it with a stub for later.

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

Rename `wdio.conf.ts` to `wdio.conf.mts` and set it up like so:
```ts
import * as path from "path"

export const config: WebdriverIO.Config = {
    runner: 'local',
    framework: 'mocha',
    specs: ['./test/specs/**/*.e2e.ts'],
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

    services: ["obsidian"],
    // You can use any wdio reporter, but they show the Chromium version
    // instead of the Obsidian version. obsidian reporter just wraps
    // spec reporter to show the Obsidian version.
    reporters: ['obsidian'],

    // wdio-obsidian-service will download Obsidian versions into this directory
    cacheDir: path.resolve(".obsidian-cache"),
    mochaOpts: {
        ui: 'bdd',
        timeout: 60000,
        // You can set mocha settings like "retry" and "bail"
    },
    logLevel: "warn",
}
```

And create a test file `test/specs/test.e2e.ts`:
```ts
import { browser } from '@wdio/globals'

describe('Test my plugin', function() {
    before(async function() {
        // You can create test vaults and open them with reloadObsidian
        // Alternatively if all your tests use the same vault, you can
        // set the default vault in the wdio.conf.mts.
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

Now you can run your tests with
```bash
wdio run ./wdio.conf.mts
```

Add that command to your `package.json` scripts and you are good to go!

`wdio-obsidian-service` has a few helper functions that can be useful in your `wdio.conf.mts`, such as `obsidianBetaAvailable` which checks if there's a current Obsidian beta and you have the credentials to download it. E.g. to test on your plugin on Obsidian `latest`, `latest-beta`, and your `minAppVersion` use:
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

See the [sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin) for more examples of how to write your `wdio.conf.mts` and e2e tests.

## Usage

### Obsidian App vs Installer Versions

Obsidian Desktop is distributed in two parts, the "installer" which is the executable containing Electron, and the "app" which is a bundle of JavaScript containing the Obsidian code. Obsidian's self-update system only updates the app JS bundle, and not the base installer/Electron version. This makes Obsidian's auto-update fast as it only needs to download a few MiB of JS instead of all of Electron. But, it means different users with the same Obsidian app version may be running on different versions of Electron, which can cause subtle differences in plugin behavior. You can specify both `appVersion` and `installerVersion` in your `wdio.conf.mts` capabilities section.

To set the app version use `browserVersion` or `'wdio:obsidianOptions'.appVersion`. It can be set to one of:
- a specific version string like "1.7.7"
- "latest": run the latest non-beta Obsidian version
- "latest-beta": run the latest beta Obsidian version (or latest if there is no current beta)
    - To download Obsidian beta versions you'll need to have an Obsidian Insiders account (see [below](#obsidian-beta-versions))
- "earliest": run the `minAppVersion` set in your plugin's `manifest.json`

To set the installer version use `'wdio:obsidianOptions'.installerVersion`. It can be set to one of:
- a specific version string like "1.7.7"
- "latest": run the latest Obsidian installer compatible with `appVersion`
- "earliest": run the oldest Obsidian installer compatible with `appVersion`

You can see more configuration options for the capabilities [here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/ObsidianCapabilityOptions.html).

### Obsidian Beta Versions

To download and test against Obsidian beta versions you'll need an Obsidian Insiders account. Set the `OBSIDIAN_EMAIL` and `OBSIDIAN_PASSWORD` environment variables or create a `.env` file with those variables set. 2FA needs to be disabled.

If you don't want to disable 2FA on your primary Obsidian account, it can be convenient to set up a second Catalyst account just for use in tests and the CI. You can also pre-download the beta versions manually using
```bash
npx obsidian-launcher download app -v latest-beta
```
which will prompt for password and 2FA. Though you'll have to rerun this each time a new beta comes out and it won't work in CI workflows.

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

## Platform Support

`wdio-obsidian-service` can test Obsidian desktop on Windows, MacOS, and Linux.

`wdio-obsidian-service` supports two approaches to testing Obsidian mobile. You can emulate the mobile UI on the desktop app, which is easy to set up but an imperfect emulation of mobile. Or you can run tests on the real mobile app using an Android Virtual Device (avd).

Testing on iOS is currently not supported.

### Mobile Emulation

Testing your plugin with "mobile emulation" is very easy to set up. Just add a capability like this in your `wdio.conf.mts`:
```js
// ...
capabilities: [{
    browserName: "obsidian",
    browserVersion: "latest",
    'wdio:obsidianOptions': {
        emulateMobile: true,
    },
    'goog:chromeOptions': {
        mobileEmulation: {
            // can also set deviceName: "iPad" etc. instead of hard-coding size
            deviceMetrics: { width: 390, height: 844 },
        },
    },
}],
```

This will use Obsidian's [app.emulateMobile](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development#Emulate+mobile+device+on+desktop) to test the mobile UI on the Electron desktop app. Note that the real Obsidian mobile app runs on [Capacitor.js ](https://capacitorjs.com) instead of Electron, so there are various platform differences that can't be properly emulated this way. E.g. Capacitor doesn't have access to node and Electron APIs, and has more limited access to the operating system. But if your plugin isn't directly interacting with the operating system or any advanced Electron APIs using mobile emulation will likely be sufficient.


### Android

You can also test on the real mobile app using [Appium](https://appium.io) and [Android Studio](https://developer.android.com/studio). This is a bit more work to set up, but is a more accurate test.

To set this up, install Appium and the Appium Android driver:
```bash
npm install --save-dev appium appium-uiautomator2-driver @wdio/appium-service
```

Then follow [these instructions](https://appium.io/docs/en/latest/quickstart/uiauto2-driver/#set-up-android-automation-requirements) to install Android Studio. You can skip the `appium driver install ...` bit as you already installed the driver via npm above.

Now you can use the Android Studio "Virtual Device Manager" to create a Android Virtual Device. Name the AVD `obsidian_test`.

Set up a new `wdio.mobile.conf.mts` file like this:
```ts
import * as path from "path"

export const config: WebdriverIO.Config = {
    runner: 'local',
    framework: 'mocha',
    specs: ['./test/specs/**/*.e2e.ts'],

    maxInstances: 1, // can't do android tests in parallel :(

    capabilities: [{
        browserName: "obsidian",
        browserVersion: "latest",
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:avd': "obsidian_test",
        'appium:noReset': true, // wdio-obsidian-service will handle installing Obsidian
        'wdio:obsidianOptions': {
            plugins: ["."],
            vault: "test/vaults/simple",
        },
    }],

    services: [
        "obsidian",
        ["appium", {
            args: { allowInsecure: "*:chromedriver_autodownload,*:adb_shell" },
        }],
    ],
    reporters: ['obsidian'],

    cacheDir: path.resolve(".obsidian-cache"),
    mochaOpts: {
        ui: 'bdd',
        timeout: 60000,
    },
    logLevel: "warn",
}
```
and run
```bash
wdio run ./wdio.mobile.conf.mts
```

This will spin up the Android Virtual Device, install Obsidian in it, and run your tests on it.

See also: The [sample plugin](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin) for an example `wdio.mobile.conf.mts` file, [Appium](https://appium.github.io/appium.io/docs/en/writing-running-appium/caps) and [Appium UiAutomator2](https://github.com/appium/appium-uiautomator2-driver?tab=readme-ov-file#capabilities) for more capability options you can use

## Test Frameworks

WebdriverIO can run tests using [Mocha](https://mochajs.org), [Jasmine](https://jasmine.github.io), and [Cucumber](https://cucumber.io/). Mocha is the easiest to set up and is used in all the `wdio-obsidian-service` examples. Mocha can also run your unit tests, typically with the addition of an assertion library like [Chai](https://www.chaijs.com). You can't run WebdriverIO using [Jest](https://jestjs.io), but if you already have Jest unit tests (or just prefer Jest) you can easily continue using Jest for your unit tests and Mocha just for your e2e tests. The built-in WebdriverIO [expect](https://webdriver.io/docs/api/expect-webdriverio) is very similar to Jest matchers, so should be familiar to use.

## API Docs

API docs, including all configuration options and helper functions, are available [here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/README.html).

Some key bits:
- See [ObsidianCapabilityOptions](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/ObsidianCapabilityOptions.html) for all the options you can pass to `wdio:obsidianOptions` in your wdio.conf.mts
- See [ObsidianBrowserCommands](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/ObsidianBrowserCommands.html) and [ObsidianPage](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/ObsidianPage.html) for various useful helper functions
- See [startWdioSession](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/startWdioSession.html) if you aren't making e2e tests but want to use WDIO for scripts that interact with Obsidian

And of course, see also [WDIO's documentation](https://webdriver.io/docs/gettingstarted) and the [many browser commands it provides](https://webdriver.io/docs/api/browser).

## GitHub CI Workflows
The sample plugin has workflows set up to release and test your plugin, which you can see [here](https://github.com/jesse-r-s-hines/wdio-obsidian-service-sample-plugin#github-workflows).

## obsidian-launcher CLI
`wdio-obsidian-service` depends on [obsidian-launcher](../../packages/obsidian-launcher/README.md) so the `obsidian-launcher` CLI is also available, with some commands for launching different Obsidian versions. CLI docs available [here](https://jesse-r-s-hines.github.io/wdio-obsidian-service/obsidian-launcher/README.html#cli).
