import { describe, it } from "mocha";
import { expect } from "chai";
import { sleep, withTimeout, pool, compareVersions } from "../../src/utils.js";


describe("withTimeout", () => {
    it("basic", async () => {
        const prom = sleep(15).then(r => "DONE");
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


describe("compareVersions", () => {
    const tests: [string, string, number][] = [
        ["0.0.0", "0.0.1", -1],
        ["0.0.1", "0.0.0", +1],
        ["0.0.1", "2.0.0", -1],
        ["2.0.0", "2.0.0",  0],
        ["2.0.0", "2.1.0", -1],
    ];

    tests.forEach(([a, b, expected]) => {
        it(`compareVersions("${a}", "${b}") == ${expected}`, () => {
            expect(Math.sign(compareVersions(a, b))).to.eq(expected);
        });
    });
});


