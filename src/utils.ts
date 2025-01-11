import * as fsAsync from "fs/promises"
import { PromisePool } from '@supercharge/promise-pool'


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


/// Misc ///

export function compareVersions(a: string, b: string) {
    const [aMajor, aMinor, aPatch] = a.split(".").map(Number);
    const [bMajor, bMinor, bPatch] = b.split(".").map(Number);
    return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}
