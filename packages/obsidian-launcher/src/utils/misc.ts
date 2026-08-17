import fsAsync from "fs/promises"
import path from "path"
import dotenv from 'dotenv';
import { createConsola } from "consola";
import { PromisePool } from '@supercharge/promise-pool'
import _ from "lodash"

/// Logging and env ///
export const consola = createConsola({
    throttle: -1, // disable throttle
    formatOptions: {
        date: false,
    },
})


const logged = new Map<string, number>();
export function warnOnce(key: string, message: string) {
    const times = logged.get(key) ?? 0;
    if (times <= 0) {
        consola.warn({message});
    }
    logged.set(key, times + 1);
}


/** Load .env files. Search all parent directories for .env files. */
export function loadEnv() {
  const envFiles: string[] = [];
  let dir = process.cwd();
  while (true) {
    envFiles.push(path.join(dir, '.env'));
    if (path.parse(dir).root == dir) break;
    dir = path.dirname(dir);
  }
  dotenv.config({ path: envFiles, quiet: true});
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

export type UntilOpts = {timeout: number, poll?: number};
export async function until<T>(func: () => Promise<T>|T, opts: UntilOpts): Promise<T> {
    const { timeout, poll = 100 } = opts;
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
            await sleep(poll);
        }
        time += poll;
    }
    if (!result) {
        throw new Error("Timed out waiting for condition" + (error ? `: ${error}` : ''));
    }
    return result;
}

export type RetryOpts = {
    retries?: number,
    backoff?: number,
    retryIf?: (error: any) => boolean,
};
/** Retries func on error */
export async function retry<T>(func: (attempt: number) => Promise<T>|T, opts: RetryOpts = {}): Promise<T> {
    const { retries = 4, backoff = 1000, retryIf = () => true } = opts;
    let attempt = 0;
    let error: any;

    while (attempt <= retries) {
        try {
            return await func(attempt);
        } catch (e: any) {
            error = e;
        }
        const delay = backoff*Math.random() + backoff*Math.pow(2, attempt);
        if (!retryIf(error) || attempt >= retries) {
            throw error; // throw without sleeping
        }
        await sleep(delay);
        attempt += 1;
    }
    throw error; // unreachable
}


/// Misc ///

/**
 * Try reading and parsing the JSON file, return undefined if it doesn't exist or is malformed
 */
export async function tryParseJson(file: string) {
    try {
        const content = await fsAsync.readFile(file, 'utf-8');
        return JSON.parse(content)
    } catch { 
        return undefined;
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


/**
 * Use a binary search to find the first entry that passes check. Assumes the list is in order such that all that fail
 * the check are before all that pass the check.
 * start and end range is [start, end)
 * guess is an optimization to start the search at a given position you expect to be most likely
 */
export async function findFirstPassing<T>(
    arr: T[], check: (x: T) => Promise<boolean>|boolean,
    {start = 0, end = arr.length, guess}: {start?: number, end?: number, guess?: number} = {},
): Promise<T | undefined> {
    if (start < 0 || end > arr.length || end < start) throw new Error(`Invalid start/end: ${start} -> ${end}`);
    if (guess != undefined && (guess < start || guess >= end)) throw new Error(`Invalid guess: ${guess}`);
    const origEnd = end;

    if (guess != undefined) {
        if (await check(arr[guess])) {
            if (guess == start || !(await check(arr[guess - 1]))) {
                return arr[guess];
            }
            end = guess - 1;
        } else {
            start = guess + 1;
        }
    }

    while (start < end) {
        const mid = Math.floor((start + end) / 2);
        if (await check(arr[mid])) {
            end = mid;
        } else {
            start = mid + 1;
        }
    }
    return start < origEnd ? arr[start] : undefined;
}
