import fsAsync from "fs/promises"
import path from "path"
import os from "os"
import { PromisePool } from '@supercharge/promise-pool'
import _ from "lodash"

/// Files ///

export async function fileExists(path: string) {
    try {
        await fsAsync.access(path);
        return true;
    } catch {
        return false;
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
 * Handles creating a file "atomically" by creating a tmpDir, then downloading or otherwise creating the file under it,
 * then renaming it to the final location when done.
 * @param dest Path the file should end up at.
 * @param func Function takes path to a temporary directory it can use as scratch space. The path it returns will be
 *     moved to `dest`. If no path is returned, it will move the whole tmpDir to dest.
 */
export async function withTmpDir(dest: string, func: (tmpDir: string) => Promise<string|void>): Promise<void> {
    dest = path.resolve(dest);
    const tmpDir = await fsAsync.mkdtemp(path.join(path.dirname(dest), `.${path.basename(dest)}.tmp.`));
    try {
        let result = await func(tmpDir) ?? tmpDir;
        if (!path.isAbsolute(result)) {
            result = path.join(tmpDir, result);
        } else if (!path.resolve(result).startsWith(tmpDir)) {
            throw new Error(`Returned path ${result} not under tmpDir`)
        }
        // rename will overwrite files but not directories
        if (await fileExists(dest) && (await fsAsync.stat(dest)).isDirectory()) {
            await fsAsync.rename(dest, tmpDir + ".old")
        }
        
        await fsAsync.rename(result, dest);
        await fsAsync.rm(tmpDir + ".old", { recursive: true, force: true });
    } finally {
        await fsAsync.rm(tmpDir, { recursive: true, force: true });
    }
}

/**
 * Tries to hardlink a file, falls back to copy if it fails
 */
export async function linkOrCp(src: string, dest: string) {
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
 * Lodash _.merge but overwrites values with undefined if present, instead of ignoring undefined.
 */
export function mergeKeepUndefined(object: any, ...sources: any[]) {
    return _.mergeWith(object, ...sources,
        (objValue: any, srcValue: any, key: any, obj: any) => {
            if (_.isPlainObject(obj) && objValue !== srcValue && srcValue === undefined) {
                obj[key] = srcValue
            }
        }
    );
}