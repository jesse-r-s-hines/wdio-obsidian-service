import { browser, expect } from '@wdio/globals'
import path from "path"
import { OBSIDIAN_CAPABILITY_KEY } from '../../src/types.js';
import { sleep } from '../../src/utils.js';


describe("Basic obsidian launch", () => {
    it('Basic', async () => {
        const elem = await browser.$("body");
        console.log(elem, await elem.getHTML())
        await sleep(10 * 1000);
    })
})
