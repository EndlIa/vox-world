import type { Result } from "../../src/util/result";

/** Unwraps a successful `Result`, failing the test on a failed one. */
export function expectOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(
      `Expected a successful result, got ${JSON.stringify(result.error)}`,
    );
  }

  return result.value;
}

/** Unwraps a failed `Result`, failing the test on a successful one. */
export function expectErr<T, E>(result: Result<T, E>): E {
  if (result.ok) {
    throw new Error("Expected a failed result");
  }

  return result.error;
}
