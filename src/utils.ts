import * as fsAsync from "fs/promises"
import * as path from "path"
import * as os from "os"
import { PromisePool } from '@supercharge/promise-pool'
import CDP from 'chrome-remote-interface'
import * as child_process from "child_process"
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


/// Promises ///

export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Awaits a promise or times out if it takes too long.
 * Returns true if the promise completed before the timeout.
 */
export async function withTimeout<T>(promise: Promise<T>, timeout: number): Promise<boolean> {
    return Promise.race([promise.then(r => true), sleep(timeout).then(r => false)])
}

/**
 * Wrapper around PromisePool that throws on any error.
 */
export async function pool<T, U>(size: number, items: T[], func: (item: T) => Promise<U>): Promise<U[]> {
    const { results } = await PromisePool
        .for(items)
        .withConcurrency(size)
        .handleError(async (error, item, pool) => { throw error; })
        .useCorrespondingResults()
        .process(func);
    return results as U[];
}


/// Misc ///

export function compareVersions(a: string, b: string) {
    const [aMajor, aMinor, aPatch] = a.split(".").map(Number);
    const [bMajor, bMinor, bPatch] = b.split(".").map(Number);
    return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}
