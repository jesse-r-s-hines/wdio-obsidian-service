import { describe, it } from "mocha";
import { expect } from "chai";
import fsAsync from "fs/promises";
import path from "path"
import { createDirectory } from "../helpers.js";
import { fileExists, withTmpDir, linkOrCp, sleep, withTimeout, pool, maybe } from "../../src/utils.js";


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

    it("relative path", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        await withTmpDir(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "a");
            return 'a';
        })
        expect(await fsAsync.readFile(dest, 'utf-8')).to.equal("a");
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

    it("return undefined", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        await withTmpDir(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "b");
        })
        expect(await fsAsync.readFile(path.join(dest, 'a'), 'utf-8')).to.equal("b");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["out"]);
    })

    it("overwrite file", async () => {
        const tmpDir = await createDirectory({"foo.txt": "bar"})
        const dest = path.join(tmpDir, "foo.txt");

        await withTmpDir(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'foo.txt'), "baz");
            return path.join(scratch, 'foo.txt');
        })
        expect(await fsAsync.readFile(dest, 'utf-8')).to.equal("baz");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["foo.txt"]);
    })

    it("overwrite folder", async () => {
        const tmpDir = await createDirectory({"out/foo.txt": "bar"});
        const dest = path.join(tmpDir, "out");

        await withTmpDir(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "b");
            return scratch;
        })
        expect(await fsAsync.readdir(dest)).to.eql(["a"]);
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

describe("linkOrCp", () => {
    it("basic", async () => {
        const tmpDir = await createDirectory({"a.txt": "A"});
        await linkOrCp(path.join(tmpDir, "a.txt"), path.join(tmpDir, "b.txt"))
        expect(await fsAsync.readFile(path.join(tmpDir, "b.txt"), 'utf-8')).to.eql("A")
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