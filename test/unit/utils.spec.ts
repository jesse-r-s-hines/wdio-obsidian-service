import { describe, it } from "mocha";
import { expect } from "chai";
import fsAsync from "fs/promises";
import path from "path"
import { createDirectory } from "../helpers.js";
import { fileExists, withTmpDir, sleep, withTimeout, pool, Version } from "../../src/utils.js";


describe("fileExists", () => {
    it("basic", async () => {
        const tmpDir = await createDirectory({"foo.txt": "foo"});
        expect(await fileExists(path.join(tmpDir, "foo.txt"))).to.equal(true);
        expect(await fileExists(path.join(tmpDir, "bar.txt"))).to.equal(false);
    })
})

describe("withTmpDir", () => {
    it("basic", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        await withTmpDir(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "a");
            await fsAsync.writeFile(path.join(scratch, 'b'), "b");
            return path.join(scratch, 'b');
        })
        expect(await fsAsync.readFile(dest, 'utf-8')).to.equal("b");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["out"]);
    })

    it("with directory", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        await withTmpDir(dest, async (scratch) => {
            await fsAsync.mkdir(path.join(scratch, 'a'));
            await fsAsync.writeFile(path.join(scratch, 'a', 'b'), "b");
            return path.join(scratch, 'a');
        })
        expect(await fsAsync.readFile(path.join(dest, 'b'), 'utf-8')).to.equal("b");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["out"]);
    })

    it("return tmpDir", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        await withTmpDir(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "b");
            return scratch;
        })
        expect(await fsAsync.readFile(path.join(dest, 'a'), 'utf-8')).to.equal("b");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["out"]);
    })

    it("errors", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        const result = await withTmpDir(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "a");
            throw Error("FOO")
        }).catch(err => err)
        expect(result).to.be.instanceOf(Error);
        expect(await fsAsync.readdir(tmpDir)).to.eql([]);
    })
})


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


describe("Version", () => {
    const tests: [string, string, number][] = [
        ["0.0.0", "0.0.1", -1],
        ["0.0.1", "0.0.0", +1],
        ["0.0.1", "2.0.0", -1],
        ["2.0.0", "2.0.0",  0],
        ["2.0.0", "2.1.0", -1],
    ];

    it(`construct`, () => {
        let version = Version("1.2.3")
        expect([version.major, version.minor, version.patch]).to.eql([1, 2, 3])

        version = Version("v1.2.3")
        expect([version.major, version.minor, version.patch]).to.eql([1, 2, 3])

        version = Version("01.02.03")
        expect([version.major, version.minor, version.patch]).to.eql([1, 2, 3])

        expect(() => Version('foo')).to.throw();
    });

    it(`toString`, () => {
        expect(Version("1.2.3").toString()).to.eql("1.2.3")
        expect(Version("v1.02.3").toString()).to.eql("1.2.3")
    });

    tests.forEach(([a, b, expected]) => {
        it(`compare versions "${a}" "${b}"`, () => {
            expect(Math.sign(Version(a).valueOf() - Version(b).valueOf())).to.eq(expected);
        });
    });
});


