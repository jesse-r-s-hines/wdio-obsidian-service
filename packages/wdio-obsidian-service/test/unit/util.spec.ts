import { describe, it } from "mocha";
import { expect } from "chai";
import { quote } from "../../src/utils.js";


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
    })
})
