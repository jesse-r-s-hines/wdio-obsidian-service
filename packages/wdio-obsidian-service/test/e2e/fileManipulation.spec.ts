import { browser, expect } from '@wdio/globals'
import fsAsync from "fs/promises";
import { TFile } from 'obsidian';
import { hash } from '../helpers.js';
import { obsidianPage } from 'wdio-obsidian-service';


describe("file manipulation", () => {
    it("delete files", async () => {
        await browser.reloadObsidian({vault: "./test/vaults/basic"});
        await obsidianPage.delete("/Goodbye.md");
        const file = await browser.executeObsidian(({app}) => app.vault.getAbstractFileByPath("Goodbye.md")?.path);
        expect(file).toEqual(null);

        // delete a second time does nothing
        await obsidianPage.delete("/Goodbye.md");

        // hidden files
        await obsidianPage.write(".hidden/file.md", "HELLO");

        let stat = await browser.executeObsidian(({app}) => app.vault.adapter.stat(".hidden/file.md"));
        expect(stat?.type).toEqual("file");

        await obsidianPage.delete(".hidden/file.md");
        stat = await browser.executeObsidian(({app}) => app.vault.adapter.stat(".hidden/file.md"));
        expect(stat).toEqual(null);

        // delete a second time does nothing
        await obsidianPage.delete(".hidden/file.md");
    })

    it("delete folders", async () => {
        await browser.reloadObsidian({vault: 'test/vaults/nested'});
        await obsidianPage.delete("B");
        const folders1 = (await browser.executeObsidian(({app}) => app.vault.adapter.list("/"))).folders;
        expect(folders1.sort()).toEqual(['.obsidian']);

        // delete a second time does nothing
        await obsidianPage.delete("B");

        // hidden folders
        await browser.executeObsidian(({app}) => app.vault.adapter.mkdir(".foo"));
        await obsidianPage.delete(".foo");
        const folders2 = (await browser.executeObsidian(({app}) => app.vault.adapter.list("/"))).folders;
        expect(folders2.sort()).toEqual(['.obsidian']);

        // delete a second time does nothing
        await obsidianPage.delete(".foo");
    })

    describe("tests in basic vault", function() {
        before(async () => {
            await browser.reloadObsidian({vault: "./test/vaults/basic"});
        })

        it("read", async () => {
            const actual = await obsidianPage.read("Welcome.md");
            const expected = await fsAsync.readFile('test/vaults/basic/Goodbye.md', 'utf-8');

            expect(actual).toEqual(expected);
        })

        it("mkdir", async () => {
            await obsidianPage.mkdir("some/nested/folder");
            const folder = await browser.executeObsidian(({app, obsidian}) => {
                const fileObj = app.vault.getAbstractFileByPath("some/nested/folder");
                if (fileObj instanceof obsidian.TFolder) {
                    return fileObj.path;
                }
            });
            expect(folder).toEqual("some/nested/folder");

            // repeat does nothing
            await obsidianPage.mkdir("some/nested/folder");
        })

        it("mkdir hidden", async () => {
            await obsidianPage.mkdir("some/.nested/folder");
            const stat = await browser.executeObsidian(({app,}) => app.vault.adapter.stat("some/.nested/folder"));
            expect(stat?.type).toEqual("folder");

            // repeat does nothing
            await obsidianPage.mkdir("some/.nested/folder");
        })

        it("write create", async () => {
            await obsidianPage.write("new.md", "stuff");
            const content = await browser.executeObsidian(({app}) =>
                app.vault.read(app.vault.getAbstractFileByPath("new.md") as TFile)
            );
            expect(content).toEqual("stuff");
        })

        it("write modify", async () => {
            await obsidianPage.write("Welcome.md", "new content");
            const content = await browser.executeObsidian(({app}) =>
                app.vault.read(app.vault.getAbstractFileByPath("Welcome.md") as TFile)
            );
            expect(content).toEqual("new content");
        })

        it("write create hidden", async () => {
            await obsidianPage.write(".new.md", "stuff");
            const content = await browser.executeObsidian(({app}) => app.vault.adapter.read(".new.md"));
            expect(content).toEqual("stuff");

            // also test read hidden here
            const readResult = await obsidianPage.read(".new.md");
            expect(readResult).toEqual("stuff");
        })

        it("write modify hidden", async () => {
            await obsidianPage.write(".new.md", "original content");
            await obsidianPage.write(".new.md", "new content");
            const content = await browser.executeObsidian(({app}) => app.vault.adapter.read(".new.md"));
            expect(content).toEqual("new content");
        })

        it("write create parent directories", async () => {
            await obsidianPage.write("folder/file.md", "stuff");
            const content = await browser.executeObsidian(({app}) =>
                app.vault.read(app.vault.getAbstractFileByPath("folder/file.md") as TFile)
            );
            expect(content).toEqual("stuff");
        })

        it("write create parent directories hidden", async () => {
            await obsidianPage.write(".folder/file.md", "stuff");
            const content = await browser.executeObsidian(({app}) => app.vault.adapter.read(".folder/file.md"));
            expect(content).toEqual("stuff");
        })

        it("write create binary", async () => {
            const expected = await fsAsync.readFile('test/vaults/fileTypes/logo.png');

            await obsidianPage.write("newImage.png", expected.buffer);

            // not using read so we can test the b64 encoding separately
            const actual = new Uint8Array(await browser.executeObsidian(async ({app}) => {
                const content = await app.vault.adapter.readBinary("newImage.png");
                return [...new Uint8Array(content)]
            }));

            expect(hash(actual)).toEqual(hash(expected));

            // also test read binary here
            const readResult = await obsidianPage.readBinary("newImage.png");
            expect(hash(readResult)).toEqual(hash(expected));
        })

        it("write modify binary", async () => {
            const logo = await fsAsync.readFile('test/vaults/fileTypes/logo.png');
            await obsidianPage.write("logo.png", logo.buffer);

            const expected = await fsAsync.readFile('test/vaults/fileTypes/example.png');
            await obsidianPage.write("logo.png", expected.buffer);

            const actual = new Uint8Array(await browser.executeObsidian(async ({app}) => {
                const content = await app.vault.adapter.readBinary("logo.png");
                return [...new Uint8Array(content)]
            }));

            expect(hash(actual)).toEqual(hash(expected));
        })

        it("write create binary hidden", async () => {
            const expected = await fsAsync.readFile('test/vaults/fileTypes/logo.png');
            await obsidianPage.write(".newImage.png", expected.buffer);

            const actual = new Uint8Array(await browser.executeObsidian(async ({app}) => {
                const content = await app.vault.adapter.readBinary(".newImage.png");
                return [...new Uint8Array(content)]
            }));

            expect(hash(actual)).toEqual(hash(expected));
        })

        it("write empty", async () => {
            await obsidianPage.write("empty.md", "");
            let stat = await browser.executeObsidian(({app,}) => app.vault.adapter.stat("empty.md"));
            expect(stat?.type).toEqual("file");

            await obsidianPage.write("empty.png", new ArrayBuffer(0));
            stat = await browser.executeObsidian(({app,}) => app.vault.adapter.stat("empty.png"));
            expect(stat?.type).toEqual("file");

            await obsidianPage.write(".empty.md", "");
            stat = await browser.executeObsidian(({app,}) => app.vault.adapter.stat(".empty.md"));
            expect(stat?.type).toEqual("file");
        })
    })
})
