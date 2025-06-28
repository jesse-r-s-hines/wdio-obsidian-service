import { browser, expect } from '@wdio/globals'
import path from "path"
import { OBSIDIAN_CAPABILITY_KEY } from '../../src/types.js';
import { sleep } from '../../src/utils.js';


describe("Basic obsidian launch", () => {
    it('Basic', async () => {
        const elem = await browser.$("body");
        // console.log(elem, await elem.getHTML())
        const data = await browser.execute(() => {
            const rand = Math.trunc(Math.random() * 1_000_000).toString();
            localStorage.setItem(`foo-${rand}`, rand);
            const data: any = {}
            for (let i = 0, len = localStorage.length; i < len; ++i ) {
                const key = localStorage.key(i)!;
                const value = localStorage.getItem(key);
                data[key] = value;
            }
            return data;
        });
        console.log(`RETURNED ${JSON.stringify(data, undefined, 4)}`);
        await sleep(10 * 1000);
    })
})
