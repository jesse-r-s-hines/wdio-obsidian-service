import { describe, it } from "mocha";
import { expect } from "chai";
import { fileExists } from "../../src/utils.js";
import { createDirectory } from "../helpers.js"
import ChromeLocalStorage from "../../src/chromeLocalStorage.js";


describe("ChromeLocalStorage", () => {
    let localStorage: ChromeLocalStorage

    beforeEach(async () => {
        localStorage = new ChromeLocalStorage(await createDirectory())
    })
    afterEach(async () => {
        localStorage.close();
    });

    it("empty folder", async () => {
        expect(await localStorage.getAllItems()).to.eql([]);
    })

    it("basics", async () => {
        await localStorage.setItem("https://www.example.com", "foo", "bar");
        expect(await localStorage.getItem("https://www.example.com", "foo")).to.eql("bar");
        expect(await fileExists(`${localStorage.userDataDir}/Local Storage/leveldb`)).to.eql(true);

        localStorage.close();
        localStorage = new ChromeLocalStorage(localStorage.userDataDir);
        
        expect(await localStorage.getAllItems()).to.have.deep.members([
            ["https://www.example.com", "foo", "bar"],
        ]);

        await localStorage.getItem("https://www.example.com", "foo")
        await localStorage.removeItem("https://www.example.com", "foo")
        expect(await localStorage.getItem("https://www.example.com", "foo")).to.equal(null);
    })

    it("putBatch", async () => {
        await localStorage.setItems("app://obsidian.md", {
            "fruit": "banana",
            "vegetable": "carrot",
        })
        expect(await localStorage.getAllItems()).to.have.deep.members([
            ["app://obsidian.md", "fruit", "banana"],
            ["app://obsidian.md", "vegetable", "carrot"],
        ]);
    })
})
