/**
 * Script that collects information for all Obsidian versions in a single file. The file can then be used to easily
 * lookup download URLs for a given Obsidian version, and check Obsidian to Electron/Chrome version mappings.
 */

import fsAsync from "fs/promises"
import { ObsidianVersionInfos } from "../src/types.js"
import { ObsidianLauncher } from "../src/obsidianLauncher.js";


const dest = process.argv[2];
if (!dest) {
    throw Error("No file specified.")
}

let versionInfos: ObsidianVersionInfos|undefined;
try {
    versionInfos = JSON.parse(await fsAsync.readFile(dest, "utf-8"))
} catch {
    versionInfos = undefined;
}
const launcher = new ObsidianLauncher({
    cacheDir: "/tmp/fetch-obsidian-versions",
})
versionInfos = await launcher.updateObsidianVersionInfos(versionInfos, { maxInstances: 1 });
fsAsync.writeFile(dest, JSON.stringify(versionInfos, undefined, 4));
