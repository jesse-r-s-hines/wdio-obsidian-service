import { describe, it } from "mocha";
import { expect } from "chai";
import { parseLinkHeader, normalizeGitHubRepo } from "../../src/apis.js";


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


describe('normalizeGithubRepo', () => {
    [
        ["SilentVoid13/Templater", "SilentVoid13/Templater"],
        ["https://github.com/Vinzent03/obsidian-git", "Vinzent03/obsidian-git"],
        ["github.com/Vinzent03/obsidian-git", "Vinzent03/obsidian-git"],
        ["http://github.com/SilentVoid13/Templater/", "SilentVoid13/Templater"],
    ].forEach(([input, expected]) => {
        it(`normalizeGithubRepo("${input}")`, async () => {
            expect(normalizeGitHubRepo(input)).to.eql(expected);
        })
    });
});
