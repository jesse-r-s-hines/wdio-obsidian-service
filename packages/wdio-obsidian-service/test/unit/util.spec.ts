import { describe, it } from "mocha";
import { expect } from "chai";
import { quote, normalizePath } from "../../src/utils.js";


describe("quote", () => {
    [
        ["a", "'a'"],
        ["path/to/my file", "'path/to/my file'"],
        ["can't", "'can'\\''t'"],
        ["a'b'c", "'a'\\''b'\\''c'"],
        ["'abc'", "''\\''abc'\\'''"],
    ].forEach(([input, expected]) => {
        it(`quote: ${input}`, async () => {
            expect(quote(input)).to.eql(expected);
        })
    });

    [
        ["a", "a"],
        ["/path/to/file/", "path/to/file"],
        ["/", "/"],
        ["", "/"],
        ["//path//to//file//", "path/to/file"],
    ].forEach(([input, expected]) => {
        it(`normalizePath: ${input}`, async () => {
            expect(normalizePath(input)).to.eql(expected);
        })
    });
})
