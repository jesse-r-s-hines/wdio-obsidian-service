import fsAsync from "fs/promises"
import path from "path"
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

/**
 * Handles creating a file "atomically" by creating a tmpDir, then downloading or otherwise creating the file under it,
 * then renaming it to the final location when done.
 * @param dest Path the file should end up at.
 * @param func Function takes path to a temporary directory it can use as scratch space. The path it returns will be
 *     moved to `dest`.
 */
export async function withTmpDir(dest: string, func: (tmpDir: string) => Promise<string>): Promise<void> {
    dest = path.resolve(dest)
    const tmpDir = await fsAsync.mkdtemp(path.join(path.dirname(dest), `.${path.basename(dest)}.tmp.`));
    try {
        const result = await func(tmpDir);
        await fsAsync.rename(result, dest);
    } finally {
        await fsAsync.rm(tmpDir, { recursive: true, force: true});
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

/**
 * Represents a simple major.minor.patch version number, and allows parsing and comparing version strings.
 */
export interface Version {
    major: number,
    minor: number,
    patch: number,
    valueOf(): number,
    toString(): string,
}

export function Version(version: string): Version {
    version = version.replace(/^v/, ''); // ignore "v" at beginning of string.
    if (!version.match(/^\d+\.\d+\.\d+$/)) {
        throw Error(`Invalid version string ${version}`);
    }
    const [major, minor, patch] = version.split(".").map(Number);
    return {
        major, minor, patch,
        valueOf() {
            return this.major * 1000 * 1000 + this.minor * 1000 + this.patch;
        },
        toString() {
            return `${this.major}.${this.minor}.${this.patch}`;
        }
    }
}
