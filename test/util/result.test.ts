import { describe, expect, it } from "vitest";

import {
  err,
  flatMap,
  map,
  mapErr,
  ok,
  unwrapOr,
  type Result,
} from "../../src/util/result";

describe("result", () => {
  it("creates a successful result with a value", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it("creates a successful void result without a value", () => {
    const result = ok();

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value).toBeUndefined();
    }
  });

  it("creates a failed result with an error", () => {
    expect(err({ code: "invalid" })).toEqual({
      ok: false,
      error: { code: "invalid" },
    });
  });

  it("maps only successful values", () => {
    const success: Result<number, string> = ok(21);
    const failure: Result<number, string> = err("failed");

    expect(map(success, (value) => value * 2)).toEqual({
      ok: true,
      value: 42,
    });
    expect(map(failure, (value) => value * 2)).toBe(failure);
  });

  it("maps only errors", () => {
    const success: Result<number, string> = ok(21);
    const failure: Result<number, string> = err("failed");

    expect(mapErr(success, (error) => error.length)).toBe(success);
    expect(mapErr(failure, (error) => error.length)).toEqual({
      ok: false,
      error: 6,
    });
  });

  it("flattens mapped results", () => {
    const success: Result<number, string> = ok(21);
    const failure: Result<number, string> = err("failed");

    expect(flatMap(success, (value) => ok(value * 2))).toEqual({
      ok: true,
      value: 42,
    });
    expect(flatMap(failure, (value) => ok(value * 2))).toBe(failure);
  });

  it("unwraps successful values or uses the fallback", () => {
    expect(unwrapOr(ok(42), 0)).toBe(42);
    expect(unwrapOr(err("failed"), 0)).toBe(0);
  });

  it("does not catch callback errors", () => {
    const callbackError = new Error("callback failed");

    expect(() =>
      map(ok(1), () => {
        throw callbackError;
      }),
    ).toThrow(callbackError);
  });
});
