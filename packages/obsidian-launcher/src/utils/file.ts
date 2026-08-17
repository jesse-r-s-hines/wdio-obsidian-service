import fsAsync from "fs/promises"
import path from "path"
import os from "os"
import fs from "fs";
import _ from "lodash"


export async function fileExists(path: string) {
    try {
        await fsAsync.stat(path);
        return true;
    } catch (e: any) {
        if (e?.code == "ENOENT") {
            return false
        }
        throw e
    }
}


/**
 * Create tmpdir under the system temporary directory.
 * @param prefix 
 * @returns 
 */
export async function makeTmpDir(prefix?: string) {
    return fsAsync.mkdtemp(path.join(os.tmpdir(), prefix ?? 'tmp-'));
}


/**
 * Tries to hardlink a file, falls back to copy if it fails
 */
export async function linkOrCp(src: string, dest: string) {
    await fsAsync.rm(dest, {recursive: true, force: true});
    try {
        await fsAsync.link(src, dest);
    } catch {
        await fsAsync.copyFile(src, dest);
    }
}


/**
 * Returns true if child is under parent. returns false if parent == child or child is outside of parent.
 */
export function pathIsUnder(parent: string, child: string): boolean {
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel != '' && rel.split(path.sep)[0] != ".." && !path.isAbsolute(rel)
}


/**
 * Handles creating a file or folder atomically.
 * 
 * It creates a scratch dir which `func` can use as scratch space to download/create the file or folder. Then it will
 * rename the result to dest.
 * 
 * Atomicity guarantees/caveats:
 * 
 * This guarantees that the dest is either successfully created or not, it will never be corrupted by an error or
 * interruption. There are some caveats when dest already exists however. `fs.rename` will atomically overwrite files,
 * but throw if dest is a folder. So if dest already exists and is a directory there is a small chance of it getting
 * interrupted during the replace. You'll still never end up with a "partial" dest, but it could remove the original
 * dest without moving in the new one. If this happens, the original dest will be moved to `[tmpId].old` so you can
 * still recover the original manually if needed.
 * 
 * If `replace` is false, this function is thread safe when dest is a folder. But if dest is a file, it is possible for
 * `fs.rename` to silently overwite dest if two processes/threads create it at almost the same time. If `replace` is
 * true, this function is thread safe when dest is a file, but not when its a folder.
 * 
 * @param dest Path the file or folder should end up at.
 * @param func Function takes path to a temporary directory it can use as scratch space. The path it
 *     returns will be moved to `dest`. If no path is returned, it will move the whole tmpDir to dest.
 * @param opts.replace If true, overwrite dest if it exists. If false, skip func if dest exists. Default true.
 * @param opts.preserveTmpDir Don't delete tmpDir on failure. Default false.
 */
export async function atomicCreate(
    dest: string, func: (scratch: string) => Promise<string|void>,
    opts: {replace?: boolean, preserveTmpDir?: boolean} = {},
): Promise<void> {
    const {replace = true, preserveTmpDir = false} = opts
    dest = path.resolve(dest);
    const parentDir = path.dirname(dest);

    if (!replace && (await fileExists(dest))) return

    await fsAsync.mkdir(parentDir, { recursive: true });
    const scratch = await fsAsync.mkdtemp(path.join(parentDir, `.${path.basename(dest)}.tmp.`));

    try {
        let result = await func(scratch) ?? scratch;
        result = path.resolve(scratch, result);
        if (!result.startsWith(scratch)) {
            throw new Error(`Returned path ${result} not under scratch`)
        }

        if (replace) {
            // rename will overwrite files but not directories
            if ((await fsAsync.stat(dest).catch(() => null))?.isDirectory()) {
                await fsAsync.rename(dest, `${scratch}.old`)
            }
            // Potential race condition here if a folder is immediately recreated
            await fsAsync.rename(result, dest);
        } else {
            if (!(await fileExists(dest))) {
                // Ignore error if folder already exists. However, because rename overwrites files, it
                // is theoretically possible replace dest if it's a file...
                await fsAsync.rename(result, dest)
                    .catch(e => { if (e?.code != 'ENOTEMPTY') throw e });
            }
        }

        await fsAsync.rm(scratch, { recursive: true, force: true });
        await fsAsync.rm(`${scratch}.old`, { recursive: true, force: true });
    } catch (e: any) {
        if (!preserveTmpDir) {
            await fsAsync.rm(scratch, { recursive: true, force: true });
        }
        throw e
    }
}


/**
 * Watch a list of files and call func whenever they change.
 */
export function watchFiles(
    files: string[],
    func: (curr: fs.Stats, prev: fs.Stats) => void,
    options: { interval: number, persistent: boolean, debounce: number },
) {
    const debouncedFunc = _.debounce((curr: fs.Stats, prev: fs.Stats) => {
        if (curr.mtimeMs > prev.mtimeMs || (curr.mtimeMs == 0 && prev.mtimeMs != 0)) {
            func(curr, prev)
        }
    }, options.debounce);
    for (const file of files) {
        fs.watchFile(file, {interval: options.interval, persistent: options.persistent}, debouncedFunc);
    }
}
