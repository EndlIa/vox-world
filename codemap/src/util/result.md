# result.ts

**职责**：用普通只读数据显式表达可预期成功或失败，避免用异常表达普通业务分支。
**接口**：`ok`、`err`、`map`、`mapErr`、`flatMap`、`unwrapOr`。
**内部**：不持有状态，不捕获回调异常，不依赖其他模块。
**依赖**：none。

## 公开类型

```ts
export type Result<T, E> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly error: E;
    };
```

- 使用普通只读可辨识联合。
- `ok` 是唯一的成功判别字段。
- 成功分支只有 `value`。
- 失败分支只有 `error`。
- 不使用 class。
- 不使用 `[value, error]` 元组。
- 不使用 `{ success: true }` 或 `{ kind: "ok" }` 等其他判别字段。
- 只通过 TypeScript 的 `readonly` 表达不可变约束，不使用 `Object.freeze`。

调用方通过判别字段收窄：

```ts
if (result.ok) {
  use(result.value);
} else {
  handle(result.error);
}
```

## 错误类型

- 使用泛型 `Result<T, E>`，不固定为 `Result<T, AppError>`。
- 每个模块可以定义自己的普通错误联合类型。
- 公共 API 的错误类型应当具体，不使用无约束的 `unknown` 作为便捷替代。
- `E` 应当是稳定、可判别、便于测试的普通数据结构。
- 跨越 Worker、持久化、IPC、项目文件或其他序列化边界时，`E` 必须是可序列化数据。
- 不得把原生 `Error` 对象直接作为跨边界错误值。
- 需要携带异常信息时，在边界层转换成普通的 `{ code, message, details? }` 数据结构。
- 不要求所有错误继承统一的 `AppError`。

## 公开接口

```ts
export function ok<T>(value: T): Result<T, never>;
export function ok(): Result<void, never>;

export function err<E>(error: E): Result<never, E>;

export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E>;

export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F>;

export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E>;

export function unwrapOr<T, E>(
  result: Result<T, E>,
  fallback: T,
): T;
```

语义：

- `ok(value)` 创建成功结果。
- `ok()` 创建 `Result<void, never>`。
- `err(error)` 创建失败结果。
- `map` 只转换成功值，失败原样传递。
- `mapErr` 只转换错误值，成功原样传递。
- `flatMap` 串联返回 `Result` 的操作，不在成功值外再包一层 `Result`。
- `unwrapOr` 成功时返回 `value`，失败时返回 `fallback`。

示例：

```ts
const success: Result<void, never> = ok();
const value: Result<number, never> = ok(42);
const failure: Result<never, ParseError> = err({ code: "invalid_hex" });

const doubled = map(ok(21), value => value * 2);
const fallback = unwrapOr(err({ code: "missing" }), 0);
```

## `Result<void>`

- 提供无参数 `ok()` 重载，专门表示 `Result<void, never>`。
- 不要求调用方写 `ok(undefined)`。
- 不单独创建 `okVoid()`。

## unwrap 边界

- Batch A 不提供会抛异常的 `unwrap()`。
- 调用方使用 `unwrapOr()`，或显式判断 `result.ok`。
- 这是为了避免绕过错误处理，不是全面禁止 `throw`。
- 如果后续确有高频使用场景，可以重新评估提供 `unwrap()`；届时它必须抛出专用 `Error` 子类，不能直接抛出 `E`。

## 使用边界

- `Result` 用于可预期、可恢复的失败，例如用户输入错误、解析失败、边界溢出、未命中或领域规则失败。
- 编程错误、内部不变量被破坏或理论上不可能的状态使用 `throw Error`。
- 第三方 API 抛出的异常可以在边界层捕获并转换成 `Result`。
- 回调内部的编程错误仍按普通异常传播；`map`、`mapErr`、`flatMap` 不统一捕获回调异常。
- 不提供 Promise 风格 API、class builder 或完整链式 API。

## 运行时冻结

- 不在每次创建 `Result` 时调用 `Object.freeze`。
- 不在开发环境自动切换冻结行为。
- 测试不得依赖运行时对象被冻结。

**依赖**：none。
