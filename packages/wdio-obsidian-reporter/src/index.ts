/**
 * @module
 * @document ../README.md
 */
import SpecReporter from '@wdio/spec-reporter';
import { RunnerStats } from "@wdio/reporter"
import { Reporters } from "@wdio/types"

class ObsidianReporter extends SpecReporter {
    constructor(options: any) {
        super({showPreface: false, ...options})
    }

    // Override this method to change the label shown for each capability 
    getHeaderDisplay(runner: RunnerStats) {
        const cap = (runner.config as any).capabilities;
        const obsidianOptions = cap?.['wdio:obsidianOptions'];

        let combo: string
        if (obsidianOptions) {
            const {appVersion, installerVersion, emulateMobile} = obsidianOptions;
            const automationName = cap['appium:options']?.automationName ?? cap['appium:automationName']
            const isAppium = automationName?.toLocaleLowerCase() == 'uiautomator2'
            if (isAppium) {
                combo = `obsidian v${appVersion} (platform: android)`;
            } else if (emulateMobile) {
                combo = `obsidian v${appVersion} (installer: v${installerVersion}, platform: emulate-mobile)`;
            } else {
                combo = `obsidian v${appVersion} (installer: v${installerVersion}, platform: ${process.platform})`;
            }
        } else { // fall back to SpecReporter behavior
            combo = this.getEnviromentCombo(runner.capabilities, undefined, runner.isMultiremote).trim()
        }
        
        // Spec file name and enviroment information
        const output = [`Running: ${combo}`]

        if ((runner.capabilities as any).sessionId) {
            output.push(`Session ID: ${(runner.capabilities as any).sessionId}`)
        }

        return output
    }
}

/**
 * Simple wrapper around `@wdio/spec-reporter` that prints the Obsidian version instead of the Chrome version.
 */
export default ObsidianReporter as Reporters.ReporterClass
