import { ObsidianWorkerService, ObsidianLauncherService } from "./src/wdio-obsidian-service.js"
import path from "path"

const obsidianServiceOptions = {
    obsidianVersionsFile: "./obsidian-versions.json",
}

export const config: WebdriverIO.Config = {
    runner: 'local',

    specs: [
        './test/e2e/**/*.ts'
    ],
   
    // How many instances of Obsidian should be launched in parallel during testing.
    maxInstances: 4,

    capabilities: [{
        browserName: 'obsidian',
        browserVersion: "1.7.7",
        'wdio:obsidianOptions': {
            installerVersion: "1.6.2",
            plugins: ["./test/plugins/basic-plugin"],
        },
    }],

    services: [[ObsidianWorkerService, obsidianServiceOptions], [ObsidianLauncherService, obsidianServiceOptions]],

    cacheDir: path.resolve(".optl"),

    framework: 'mocha',
    
    reporters: ['spec'],

    mochaOpts: {
        ui: 'bdd',
        timeout: 60000
    },
}
