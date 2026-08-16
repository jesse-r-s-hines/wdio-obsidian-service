import { describe, it } from "mocha";
import { expect } from "chai";
import fsAsync from "fs/promises";
import path from "path"
import { createDirectory } from "../helpers.js";
import { fileExists, atomicCreate, linkOrCp, pathIsUnder } from "../../src/utils/file.js";


describe("fileExists", () => {
    it("basic", async () => {
        const tmpDir = await createDirectory({"foo.txt": "foo"});
        expect(await fileExists(path.join(tmpDir, "foo.txt"))).to.equal(true);
        expect(await fileExists(path.join(tmpDir, "bar.txt"))).to.equal(false);
    })
})

describe("atomicCreate", () => {
    it("basic", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        await atomicCreate(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "A");
            await fsAsync.writeFile(path.join(scratch, 'b'), "B");
            return path.join(scratch, 'b');
        }, {replace: false})
        expect(await fsAsync.readFile(dest, 'utf-8')).to.equal("B");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["out"]);
    })

    it("basic keep", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        await atomicCreate(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "A");
            await fsAsync.writeFile(path.join(scratch, 'b'), "B");
            return path.join(scratch, 'b');
        }, {replace: true})
        expect(await fsAsync.readFile(dest, 'utf-8')).to.equal("B");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["out"]);
    })

    it("relative path", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        await atomicCreate(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "A");
            return 'a';
        })
        expect(await fsAsync.readFile(dest, 'utf-8')).to.equal("A");
    })

    it("directory", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        await atomicCreate(dest, async (scratch) => {
            await fsAsync.mkdir(path.join(scratch, 'a'));
            await fsAsync.writeFile(path.join(scratch, 'a', 'b'), "B");
            return path.join(scratch, 'a');
        })
        expect(await fsAsync.readFile(path.join(dest, 'b'), 'utf-8')).to.equal("B");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["out"]);
    })

    it("return scratch", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        await atomicCreate(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "B");
            return scratch;
        })
        expect(await fsAsync.readFile(path.join(dest, 'a'), 'utf-8')).to.equal("B");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["out"]);
    })

    it("return undefined", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        await atomicCreate(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "B");
        })
        expect(await fsAsync.readFile(path.join(dest, 'a'), 'utf-8')).to.equal("B");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["out"]);
    })

    it("replace file", async () => {
        const tmpDir = await createDirectory({"foo.txt": "FOO"})
        const dest = path.join(tmpDir, "foo.txt");

        await atomicCreate(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'foo.txt'), "BAR");
            return path.join(scratch, 'foo.txt');
        }, {replace: true})
        expect(await fsAsync.readFile(dest, 'utf-8')).to.equal("BAR");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["foo.txt"]);
    })

    it("replace folder", async () => {
        const tmpDir = await createDirectory({"out/foo.txt": "FOO"});
        const dest = path.join(tmpDir, "out");

        await atomicCreate(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "BAR");
            return scratch;
        }, {replace: true})
        expect(await fsAsync.readdir(dest)).to.eql(["a"]);
        expect(await fsAsync.readFile(path.join(dest, 'a'), 'utf-8')).to.equal("BAR");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["out"]);
    })

    it("keep file", async () => {
        const tmpDir = await createDirectory({"foo.txt": "FOO"})
        const dest = path.join(tmpDir, "foo.txt");

        await atomicCreate(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'foo.txt'), "BAR");
            return path.join(scratch, 'foo.txt');
        }, {replace: false})
        expect(await fsAsync.readFile(dest, 'utf-8')).to.equal("FOO");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["foo.txt"]);
    })

    it("keep folder", async () => {
        const tmpDir = await createDirectory({"out/foo.txt": "FOO"});
        const dest = path.join(tmpDir, "out");

        await atomicCreate(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "BAR");
            return scratch;
        }, {replace: false})
        expect(await fsAsync.readdir(dest)).to.eql(["foo.txt"]);
        expect(await fsAsync.readFile(path.join(dest, 'foo.txt'), 'utf-8')).to.equal("FOO");
        expect(await fsAsync.readdir(tmpDir)).to.eql(["out"]);
    })

    it("creates parent directory", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "a/b/c.txt");
        await atomicCreate(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'c.txt'), "C");
            return path.join(scratch, 'c.txt');
        })
        expect(await fsAsync.readFile(dest, 'utf-8')).to.equal("C");
    })

    it("errors", async () => {
        const tmpDir = await createDirectory();
        const dest = path.join(tmpDir, "out");
        const result = await atomicCreate(dest, async (scratch) => {
            await fsAsync.writeFile(path.join(scratch, 'a'), "a");
            throw Error("FOO")
        }).catch(err => err)
        expect(result).to.be.instanceOf(Error);
        expect(await fsAsync.readdir(tmpDir)).to.eql([]);
    })
})

describe("linkOrCp", () => {
    it("basic", async () => {
        const tmpDir = await createDirectory({"a.txt": "A"});
        await linkOrCp(path.join(tmpDir, "a.txt"), path.join(tmpDir, "b.txt"))
        expect(await fsAsync.readFile(path.join(tmpDir, "b.txt"), 'utf-8')).to.eql("A")
    });

    it("already exists basic", async () => {
        const tmpDir = await createDirectory({"a.txt": "A", "b.txt": "B"});
        await linkOrCp(path.join(tmpDir, "a.txt"), path.join(tmpDir, "b.txt"))
        expect(await fsAsync.readFile(path.join(tmpDir, "b.txt"), 'utf-8')).to.eql("A")
    });
});

describe("pathIsUnder", () => {
    const tests: [string, string, boolean][] = [
        ["", "", false],
        ["a/b/c/d", "hello/world", false],
        ["a/b", "a/b/c", true],
        ["a/b", "a/b", false],
        ["a", "a/..b", true],
        ["a/b", "b/..b", false],
    ];
    if (process.platform == "win32") {
        tests.push(
            ['C:/', 'D:/', false],
            ['C:/', 'D:/a', false],
            ['C:/', 'C:/a/b/c', true],
            ['C:/x', 'C:/a/b/c', false],
        )
    } else {
        tests.push(
            ["/", "/", false],
            ["/a", "/a", false],
            ["/a", "/a/b", true],
            ["/a", "/a/b/c", true],
        )
    }
    
    tests.forEach(([parent, child, expected]) => {
        it(`pathIsUnder ${parent} ${child}`, () => {
            expect(pathIsUnder(parent, child)).to.eql(expected);
        });
    })
});
