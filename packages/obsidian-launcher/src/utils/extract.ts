/** Utils for extracting Obsidian installers */
import fs from "fs"
import path from "path"
import child_process from "child_process"
import { pipeline } from "stream/promises";
import zlib from "zlib"
import { fileURLToPath } from "url"


/**
 * Run 7zip.
 * Note there's some weirdness around absolute paths because of the way wasm's filesystem works. The root is mounted
 * under /nodefs, so either use relative paths or prefix paths with /nodefs.
 */
export async function run7z(args: string[], options?: child_process.SpawnOptions) {
    // run 7z.js script as sub_process (so it doesn't block the main thread)
    const sevenZipScript = path.resolve(fileURLToPath(import.meta.url), '../7z.js');
    const proc = child_process.spawn(process.execPath, [sevenZipScript, ...args], {
        stdio: "pipe",
        ...options,
    });

    let stdout = "", stderr = "";
    proc.stdout!.on('data', data => stdout += data);
    proc.stderr!.on('data', data => stderr += data);
    const procExit = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? -1)));
    const exitCode = await procExit;

    const result = {stdout, stderr}
    if (exitCode != 0) {
        throw Error(`"7z ${args.join(' ')}" failed with ${exitCode}:\n${stdout}\n${stderr}`)
    }
    return result;
}


export async function extractGz(archive: string, dest: string) {
    await pipeline(fs.createReadStream(archive), zlib.createGunzip(), fs.createWriteStream(dest));
}


export async function extract7z(archive: string, dest: string, opts: {files?: string[]} = {}) {
    const cwd = path.dirname(dest);
    await run7z(["x",
        `-o${path.relative(cwd, dest).split(path.sep).join("/")}`,
        path.relative(cwd, archive).split(path.sep).join("/"),
        ...(opts.files ?? []),
    ], {cwd});
}
