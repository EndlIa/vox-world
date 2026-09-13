import { describe, expect, it } from "vitest";

import { compareStrings } from "../../src/util/order";

describe("compareStrings", () => {
  it("orders by UTF-16 code unit instead of by locale", () => {
    expect(compareStrings("a", "b")).toBe(-1);
    expect(compareStrings("b", "a")).toBe(1);
    expect(compareStrings("n1", "n1")).toBe(0);
    // A locale-aware comparator would order these the other way round.
    expect(compareStrings("B", "a")).toBe(-1);
    expect(compareStrings("node-10", "node-9")).toBe(-1);
  });

  it("gives string identities one deterministic order", () => {
    expect(["n2", "n10", "n1"].sort(compareStrings)).toEqual(["n1", "n10", "n2"]);
  });
});
