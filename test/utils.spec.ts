import { describe, it } from "mocha";
import { expect } from "chai";
import { compareVersions } from "../src/utils.js";

describe("compareVersions", () => {
      it("Basic", () => {
        expect(compareVersions("0.0.0", "0.0.1")).to.eq(-1);
    });
});