import fsAsync from "fs/promises"
import fs from "fs";
import path from "path"
import os from "os"
import { consola } from "consola";
import { PromisePool } from '@supercharge/promise-pool'
import _ from "lodash"

/// Files ///

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

const logged = new Map<string, number>();
export function warnOnce(key: string, message: string) {
    const times = logged.get(key) ?? 0;
    if (times <= 0) {
        consola.warn({message});
    }
    logged.set(key, times + 1);
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
 * `fs.rename` to silently overwite dest if two processes/threads create it at almost the  same time. If `replace` is
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


/// Promises ///

export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Await a promise or reject if it takes longer than timeout.
 */
export async function withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const result = Promise.race([
        promise,
        new Promise<T>((resolve, reject) => timer = setTimeout(() => reject(Error("Promise timed out")), timeout))
    ])
    return result.finally(() => clearTimeout(timer));
}

/**
 * Wrapper around PromisePool that throws on any error.
 */
export async function pool<T, U>(size: number, items: T[], func: (item: T) => Promise<U>): Promise<U[]> {
    const { results } = await PromisePool
        .for(items)
        .withConcurrency(size)
        .handleError(async (error) => { throw error; })
        .useCorrespondingResults()
        .process(func);
    return results as U[];
}

export type SuccessResult<T> = {success: true, result: T, error: undefined};
export type ErrorResult = {success: false, result: undefined, error: any};
export type Maybe<T> = SuccessResult<T>|ErrorResult;

/**
 * Helper for handling asynchronous errors with less hassle.
 */
export async function maybe<T>(promise: Promise<T>): Promise<Maybe<T>> {
    return promise
        .then(r => ({success: true, result: r, error: undefined} as const))
        .catch(e => ({success: false, result: undefined, error: e} as const));
}

export async function until<T>(func: () => Promise<T>|T, timeout: number): Promise<T> {
    let time = 0;
    let result: any;
    let error: any;
    while (!result && time < timeout) {
        try {
            result = await func();
            error = undefined;
        } catch (e: any) {
            error = e
        }
        if (!result) {
            await sleep(100);
        }
        time += 100;
    }
    if (!result) {
        throw new Error("Timed out waiting for condition" + (error ? `: ${error}` : ''));
    }
    return result;
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


export type CanonicalForm = {
    [key: string]: CanonicalForm|null,
};

/**
 * Normalize object key order and remove any undefined values.
 * CanonicalForm is an object with keys in the order you want.
 * - If a value is "null" the value under that key won't be changed
 * - if its an object, the value will also be normalized to match that object's key order
 */
export function normalizeObject<T>(canonical: CanonicalForm, obj: T): T {
    // might be better to just use zod or something for this
    const rootCanonical = canonical, rootObj = obj;
    function helper(canonical: any, obj: any) {
        if (_.isPlainObject(canonical)) {
            if (_.isPlainObject(obj)) {
                obj = _.pick(obj, Object.keys(canonical))
                obj = _.mapValues(obj, (v, k) => helper(canonical[k], v));
                obj = _.omitBy(obj, v => v === undefined);
                return obj;
            } else {
                return obj;
            }
        } else if (canonical === null) {
            return obj;
        } else {
            throw Error(`Invalid canonical form ${JSON.stringify(rootCanonical)}`);
        }
    }
    return helper(rootCanonical, rootObj);
}
