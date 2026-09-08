export type Result<T, E> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly error: E;
    };

export function ok(): Result<void, never>;
export function ok<T>(value: T): Result<T, never>;
export function ok<T>(value?: T): Result<T | void, never> {
  return {
    ok: true,
    value,
  };
}

export function err<E>(error: E): Result<never, E> {
  return {
    ok: false,
    error,
  };
}

export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.value));
  }

  return result;
}

export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  if (result.ok) {
    return result;
  }

  return err(fn(result.error));
}

export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  if (result.ok) {
    return fn(result.value);
  }

  return result;
}

export function unwrapOr<T, E>(
  result: Result<T, E>,
  fallback: T,
): T {
  if (result.ok) {
    return result.value;
  }

  return fallback;
}
