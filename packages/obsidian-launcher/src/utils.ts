import fsAsync from "fs/promises"
import fs from "fs";
import path from "path"
import os from "os"
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

/**
 * Handles creating a file or folder "atomically" by creating a tmpDir, then downloading or otherwise creating the file
 * under it, then renaming it to the final location when done.
 * @param dest Path the file or folder should end up at.
 * @param func Function takes path to a temporary directory it can use as scratch space. The path it returns will be
 *     moved to `dest`. If no path is returned, it will move the whole tmpDir to dest.
 * @param opts.preserveTmpDir Don't delete tmpDir on failure. Default false.
 */
export async function atomicCreate(
    dest: string, func: (tmpDir: string) => Promise<string|void>,
    opts: {preserveTmpDir?: boolean} = {},
): Promise<void> {
    dest = path.resolve(dest);
    await fsAsync.mkdir(path.dirname(dest), { recursive: true });
    const tmpDir = await fsAsync.mkdtemp(path.join(path.dirname(dest), `.${path.basename(dest)}.tmp.`));
    let success = false;
    try {
        let result = await func(tmpDir) ?? tmpDir;
        result = path.resolve(tmpDir, result);
        if (!result.startsWith(tmpDir)) {
            throw new Error(`Returned path ${result} not under tmpDir`)
        }
        // rename will overwrite files but not directories
        if (await fileExists(dest) && (await fsAsync.stat(dest)).isDirectory()) {
            await fsAsync.rename(dest, tmpDir + ".old")
        }
        await fsAsync.rename(result, dest);
        success = true;
    } finally {
        if (success) {
            await fsAsync.rm(tmpDir + ".old", { recursive: true, force: true });
            await fsAsync.rm(tmpDir, { recursive: true, force: true });
        } else if (!opts.preserveTmpDir) {
            await fsAsync.rm(tmpDir, { recursive: true, force: true });
        }
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
