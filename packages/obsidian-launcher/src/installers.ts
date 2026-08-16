/** Functions for handling Obsidian installers on different platforms */
import fsAsync from "fs/promises"
import path from "path"
import { promisify } from "util";
import child_process from "child_process"
import { atomicCreate } from "./utils/file.js";
import { extract7z, extractGz } from "./utils/extract.js";
const execFile = promisify(child_process.execFile);


/** Running AppImage requires libfuse2, extracting the AppImage first avoids that. */
export async function extractObsidianAppImage(appImage: string, dest: string) {
    // Could also use `--appimage-extract`, but we 7z allows extracting without running the executable
    await atomicCreate(dest, async (scratch) => { await extract7z(appImage, scratch) });
}


/** Extract the obsidian.tar.gz */
export async function extractObsidianTar(tar: string, dest: string) {
    await atomicCreate(dest, async (scratch) => {
        const inflated = path.join(scratch, "inflated.tar");
        await extractGz(tar, inflated);
        const extracted = path.join(scratch, "extracted");
        await extract7z(inflated, extracted);
        return path.join(extracted, (await fsAsync.readdir(extracted)).find(p => p.match("obsidian-"))!);
    })
}


/**
 * Obsidian appears to use NSIS to bundle their Window's installers. We want to extract the executable
 * files directly without running the installer. 7zip can extract the raw files from the exe.
 */
export async function extractObsidianExe(exe: string, arch: NodeJS.Architecture, dest: string) {
    // The installer contains several `.7z` files with files for different architectures
    let subArchive: string
    if (arch == "x64") {
        subArchive = `$PLUGINSDIR/app-64.7z`;
    } else if (arch == "ia32") {
        subArchive = `$PLUGINSDIR/app-32.7z`;
    } else if (arch == "arm64") {
        subArchive = `$PLUGINSDIR/app-arm64.7z`;
    } else {
        throw Error(`No Obsidian installer found for ${process.platform} ${process.arch}`);
    }
    await atomicCreate(dest, async (scratch) => {
        await extract7z(exe, path.join(scratch, "installer"), {files: [subArchive]});
        await extract7z(path.join(scratch, "installer", subArchive), path.join(scratch, "obsidian"));
        return path.join(scratch, "obsidian");
    })
}


/** Extract the executable from the Obsidian dmg installer. */
export async function extractObsidianDmg(dmg: string, dest: string) {
    dest = path.resolve(dest);

    await atomicCreate(dest, async (scratch) => {
        if (process.platform == "darwin") {
            const proc = await execFile('hdiutil', ['attach', '-nobrowse', '-readonly', dmg]);
            const volume = proc.stdout.match(/\/Volumes\/.*$/m)![0];
            // Current mac dmg files just have `Obsidian.app`, but on older '-universal' ones it's nested another level.
            const files = await fsAsync.readdir(volume);
            let obsidianApp = files.includes("Obsidian.app") ? "Obsidian.app" : path.join(files[0], "Obsidian.app");
            obsidianApp = path.join(volume, obsidianApp);
            try {
                await fsAsync.cp(obsidianApp, scratch, {recursive: true, verbatimSymlinks: true, preserveTimestamps: true});
            } finally {
                await execFile('hdiutil', ['detach', volume]);
            }
            // Clear the `com.apple.quarantine` bit to avoid MacOS bocking the downloaded Obsidian executable "Obsidian
            // is damaged and can't be opened. This file was downloaded on an unknown date". See issue #46 and https://ss64.com/mac/xattr.html
            await execFile('xattr', ['-cr', scratch]);
            return scratch;
        } else {
            // we'll use 7zip if you aren't on MacOS so that we can still extract the executable on other platforms
            // (needed for the update-obsidian-versions GitHub workflow)
            await extract7z(dmg, scratch, {files: ["*/Obsidian.app", "Obsidian.app"]});
            const files = await fsAsync.readdir(scratch);
            const obsidianApp = files.includes("Obsidian.app") ? "Obsidian.app" : path.join(files[0], "Obsidian.app");
            return path.join(scratch, obsidianApp);
        }
    });
}
