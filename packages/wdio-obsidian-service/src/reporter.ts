import SpecReporter from '@wdio/spec-reporter';
import { RunnerStats } from "@wdio/reporter"
import { Reporters } from "@wdio/types"


/**
 * Simple extension of SpecReporter that print the Obsidian version instead of the Chrome version.
 */
class ObsidianReporter extends SpecReporter {
    constructor(options: any) {
        super({showPreface: false, ...options})
    }

    // Override this method to change the label shown for each capability 
    getHeaderDisplay(runner: RunnerStats) {
        const obsidianOptions = (runner.config as any).capabilities?.['wdio:obsidianOptions']

        let combo: string
        if (obsidianOptions) {
            const appVersion = obsidianOptions.appVersion;
            const installerVersion = obsidianOptions.installerVersion;
            combo = `obsidian v${appVersion} (installer: v${installerVersion})`
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

export default ObsidianReporter as Reporters.ReporterClass
