import { describe, it } from "mocha";
import { expect } from "chai";
import { parseLinkHeader } from "../../src/apis.js";


describe("parseLinkHeader", () => {
    const tests: any[] = [
        [
            '',
            {},
        ],
        [
            '<https://www.example.com?page=2>; rel="prev"',
            {
                "prev": {
                  "rel": "prev",
                  "url": "https://www.example.com?page=2",
                },
            },
        ],
        [
            '<https://www.example.com?page=2>; rel="prev"; foo=bar, <https://www.example.com?page=4>; rel="next"',
            {
                "next": {
                  "rel": "next",
                  "url": "https://www.example.com?page=4",
                },
                "prev": {
                  "rel": "prev",
                  "foo": "bar",
                  "url": "https://www.example.com?page=2",
                },
            },
        ],
        [ // Should ignore invalid entries
            '<https://www.example.com?page=2>; invalid, <https://www.example.com?page=4>; rel="next"',
            {
                "next": {
                  "rel": "next",
                  "url": "https://www.example.com?page=4",
                },
            },
        ],
    ]

    tests.forEach(([header, expected]) => {
        it(`parseHeader ${header}`, () => {
            expect(parseLinkHeader(header)).to.eql(expected);
        })
    })

})

