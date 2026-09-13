# order.ts

**职责**：为稳定身份字符串提供唯一的升序比较规则，供各模块的 canonical 排序共用；不承载业务语义。
**接口**：`compareStrings`。
**内部**：纯函数，无状态、无其他依赖。
**依赖**：none。

## compareStrings

```ts
export function compareStrings(left: string, right: string): -1 | 0 | 1;
```

- 按 UTF-16 码元做 `<` / `>` 比较，不使用 `localeCompare`，不区分区域设置；同一对输入在任何进程、任何区域设置下得到同一顺序。
- 不 trim、不折叠大小写、不解析数字段：身份是稳定不透明字符串，顺序只用于 canonical 输出与持久化 diff 的稳定性。
- 不修改入参，不抛异常，总能返回 `-1`、`0` 或 `1`。
- 需要按身份字符串排序的模块必须共用本函数，不得各自复制比较实现；比较对象字段时由调用方取出字符串后传入（例如 `compareStrings(left.id, right.id)`）。

**依赖**：none。
