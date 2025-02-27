import * as fs from "fs"
import * as child_process from "child_process"

const newVersion = process.argv[2]
if (!newVersion) {
    console.error("Pass a new version string")
    process.exit(1)
} else if (!newVersion.match(/^\d+\.\d+\.\d+$/)) {
    console.error(`Invalid version ${newVersion}`)
    process.exit(1)
}

const obsidianLauncherPath = "packages/obsidian-launcher/package.json"
const obsidianLauncher = JSON.parse(fs.readFileSync(obsidianLauncherPath))
const wdioObsidianServicePath = "packages/wdio-obsidian-service/package.json"
const wdioObsidianService = JSON.parse(fs.readFileSync(wdioObsidianServicePath))

// keep the packages version numbers in sync
obsidianLauncher.version = newVersion
wdioObsidianService.version = newVersion
wdioObsidianService.dependencies['obsidian-launcher'] = `^${newVersion}`

fs.writeFileSync(obsidianLauncherPath, JSON.stringify(obsidianLauncher, null, '    ') + "\n");
fs.writeFileSync(wdioObsidianServicePath, JSON.stringify(wdioObsidianService, null, '    ') + "\n");
// Need to update package-lock.json
child_process.execFileSync('npm', ['install'], {stdio: "inherit"});
