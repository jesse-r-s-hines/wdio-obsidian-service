import { describe, it } from "mocha";
import { expect } from "chai";
import { 
    sleep, withTimeout, pool, maybe, normalizeObject, CanonicalForm, until, retry, findFirstPassing,
} from "../../src/utils/misc.js";


describe("withTimeout", () => {
    it("basic", async () => {
        const prom = sleep(15).then(() => "DONE");
        let result = await withTimeout(prom, 5).catch(e => e);
        expect(result).to.be.instanceOf(Error);
        result = await withTimeout(prom, 20).catch(e => e);
        expect(result).to.be.eql("DONE");
    });
});


describe("pool", () => {
    it("preserves order", async () => {
        const nums = [7, 6, 4, 9, 1, 2, 3]
        const result = await pool(4, nums, async (num) => {
            await sleep(num * 10);
            return num * 10;
        });
        expect(result).to.eql([70, 60, 40, 90, 10, 20, 30])
    });

    it("throws exceptions", async () => {
        const promises = [
            async () => 1,
            async () => { throw new Error("FOO") },
            async () => 3,
        ]
        const result = await pool(1, promises, func => func()).catch(r => r);
        expect(result).to.be.instanceOf(Error);
    });
});

describe("maybe", () => {
    it("success", async () => {
        const result = await maybe(new Promise(resolve => resolve(1)));
        expect(result.success).to.equal(true);
        expect(result.result).to.eql(1);
        expect(result.error).to.equal(undefined);
    });

    it("success", async () => {
        const result = await maybe(new Promise((resolve, reject) => reject(Error("foo"))));
        expect(result.success).to.equal(false);
        expect(result.result).to.equal(undefined);
        expect(result.error).to.be.instanceOf(Error);
        expect(result.error.message).to.eql("foo");
    });
});


describe("normalizeObject", () => {
    const tests: {name: string, canonical: CanonicalForm, input: any, expected: any}[] = [
        {
            name: "empty",
            canonical: {},
            input: {},
            expected: {},
        }, {
            name: "basic",
            canonical: {a: null, b: null},
            input: {b: 2, a: 1},
            expected: {a: 1, b: 2},
        }, {
            name: "nested",
            canonical: {a: null, b: {c: null, a: null}},
            input: {b: {a: 1, c: 2}, a: 3},
            expected: {a: 3, b: {c: 2, a: 1}},
        }, {
            name: "missing",
            canonical: {a: null, b: {c: null, a: null}},
            input: {a: 3},
            expected: {a: 3},
        }, {
            name: "missing undefined",
            canonical: {a: null, b: {c: null, a: null}},
            input: {a: 3, b: undefined},
            expected: {a: 3},
        }, {
            name: "missing nested",
            canonical: {a: null, b: {c: {d: null}, f: null}},
            input: {b: {f: 2}, a: 3},
            expected: {a: 3, b: {f: 2}},
        }, {
            name: "empty object",
            canonical: {a: null, b: {c: null, a: null}},
            input: {},
            expected: {},
        }, {
            name: "extra",
            canonical: {a: null, b: {c: null, a: null}},
            input: {a: 1, b: {c: 2, a: 3, x: 4}, x: 4},
            expected: {a: 1, b: {c: 2, a: 3}}
        }, {
            name: "undefined",
            canonical: {a: null, b: {c: null, a: null}},
            input: {a: undefined, b: {c: undefined, a: undefined}},
            expected: {b: {}},
        }, {
            name: "null with object value",
            canonical: {a: null, b: null},
            input: {b: {c: 1, x: 2}, a: 1},
            expected: {a: 1, b: {c: 1, x: 2}},
        },
    ];
    
    tests.forEach(({name, canonical, input, expected}) => {
        it(`normalizeObject ${name}`, () => {
            const actual = normalizeObject(canonical, input);
            // make sure undefined were removed
            expect(actual).to.eql(expected);
            // make sure order matches
            expect(JSON.stringify(actual)).to.eql(JSON.stringify(expected));
        });
    })
})

describe("until", () => {
    it("success", async () => {
        const result = await until(() => "HELLO", {timeout: 100, poll: 10})
        expect(result).to.equal("HELLO");
    });

    it("Timeout", async () => {
        const result = await until(() => false, {timeout: 100, poll: 10}).catch(r => r);
        expect(result).to.be.instanceOf(Error);
    })

    it("Timeout error", async () => {
        const result = await until(() => { throw Error("foo") }, {timeout: 100, poll: 10}).catch(r => r);
        expect(result).to.be.instanceOf(Error);
        expect(result.toString()).to.match(/foo/);
    })
})

describe("retry", () => {
    it("basic success", async () => {
        const result = await retry(() => "HELLO");
        expect(result).to.equal("HELLO");
    });

    it("retry failure", async () => {
        const result = await retry(
            (attempt) => { throw Error(`attempt: ${attempt}`) },
            {backoff: 0.1, retries: 3},
        ).catch(e => e);
        expect(result).to.be.instanceOf(Error);
        expect(result.toString()).to.match(/attempt: 3/);
    })

    it("instant failure", async () => {
        const result = await retry((attempt) => {
            throw Error(attempt == 1 ? "unrecoverable" : "recoverable");
        }, {
            retries: 5,
            backoff: 0.1,
            retryIf: e => !e.toString().includes("unrecoverable"),
        }).catch(r => r);
        expect(result).to.be.instanceOf(Error);
        expect(result.toString()).to.match(/unrecoverable/);
    });
})

describe("findFirstPassing", () => {
    const tests: {
        name: string,
        arr: any[], cond: (x: any) => boolean,
        start?: any, end?: any, guess?: number,
        expected: any,
    }[] = [
        {name: "middle", arr: [1, 2, 3, 4, 5], cond: x => x >= 3, expected: 3},
        {name: "strings", arr: ['a', 'b', 'c', 'd', 'e'], cond: x => x >= "c", expected: "c"},
        {name: "first element", arr: [1, 2, 3, 4, 5], cond: x => x >= 0, expected: 1},
        {name: "last element", arr: [1, 2, 3, 4, 5], cond: x => x >= 5, expected: 5},
        {name: "none pass", arr: [1, 2, 3, 4, 5], cond: x => x >= 6, expected: undefined},
        {name: "all pass", arr: [1, 2, 3, 4, 5], cond: x => x >= -1, expected: 1},
        {name: "single passing", arr: [5], cond: x => x >= 3, expected: 5},
        {name: "single failing", arr: [1], cond: x => x >= 3, expected: undefined},
        {name: "even length", arr: [1, 2, 3, 4, 5, 6], cond: x => x >= 4, expected: 4},
        {name: "duplicates", arr: [1, 2, 2, 2, 3], cond: x => x >= 2, expected: 2},
        {name: "bounds", arr: [1, 2, 3, 4, 5], start: 1, end: 4, cond: x => x >= 0, expected: 2},
        {name: "end is exclusive", arr: [1, 2, 3, 4, 5], start: 0, end: 2, cond: x => x >= 3, expected: undefined},
        {name: "no match", arr: [1, 2, 3, 4, 5], start: 0, end: 3, cond: x => x >= 10, expected: undefined},
        {name: "empty range", arr: [1, 2, 3, 4, 5], start: 2, end: 2, cond: x => x >= 0, expected: undefined},
        {name: "empty", arr: [], cond: () => true, expected: undefined},
        {name: "single element passing", arr: [1, 2, 3, 4, 5], start: 2, end: 3, cond: x => x >= 3, expected: 3},
        {name: "single element failing", arr: [1, 2, 3, 4, 5], start: 2, end: 3, cond: x => x >= 4, expected: undefined},
        {name: "guess right", arr: [1, 2, 3, 4, 5], guess: 3, cond: x => x >= 3, expected: 3},
        {name: "guess wrong start", arr: [1, 2, 3, 4, 5], guess: 0, cond: x => x >= 3, expected: 3},
        {name: "guess wrong end", arr: [1, 2, 3, 4, 5], guess: 4, cond: x => x >= 3, expected: 3},
        {name: "guess wrong middle", arr: [1, 2, 3, 4, 5], guess: 1, cond: x => x >= 3, expected: 3},
    ];

    tests.forEach(({name, arr, cond, start, end, guess, expected}) => {
        it(name, async () => {
            const result = await findFirstPassing(arr, cond, {start, end, guess});
            expect(result).to.equal(expected);
        });
    });

    it("async", async () => {
        const arr = [1, 2, 3, 4, 5];
        const result = await findFirstPassing(arr, async (x) => {
            await sleep(1);
            return x >= 3;
        });
        expect(result).to.equal(3);
    });
})
