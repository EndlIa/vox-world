# packed-int.ts

**职责**：把三维整数体素坐标打包为无字符串分配、可稳定排序的数值键，并提供解包、比较、范围检查和邻接偏移原语。
**接口**：`pack`、`unpack`、`compare`、`boundsCheck`、`neighbor`。
**内部**：每轴 16 bit，共 48 bit；使用 bias offset；所有失败显式返回 `Result`。
**依赖**：`util/result`。

## 坐标范围

```ts
export const MIN_COORDINATE = -32768;
export const MAX_COORDINATE = 32767;
```

- 每个轴使用 signed 16-bit。
- 三个轴合计 48 bit，最大值 `2^48 - 1`，仍在 JavaScript `number` 的精确整数范围内。
- 坐标必须是有限整数。
- 不接受 `NaN`、`Infinity`、小数、非安全整数或范围外的值。
- `packed-int` 的范围是体素键的权威范围；生成、导入和变换坐标的上层必须遵守该限制。
- 不使用 `bigint`，也不使用字符串键。

## VoxelKey

```ts
export type VoxelKey = number & {
  readonly __brand: "VoxelKey";
};
```

- 运行时值是 `0..2^48 - 1` 范围内的非负安全整数。
- brand 只用于 TypeScript 类型约束，运行时仍是普通 `number`。
- `VoxelKey` 适合直接作为 `Map`/`Set` 键，不需要字符串拼接。
- `VoxelKey` 只能由 `pack` 或 `neighbor` 成功返回。
- 不提供公开的 unchecked cast。
- 数值升序即领域要求的稳定排序顺序。

## 打包布局

```text
x: 高 16 bit
y: 中 16 bit
z: 低 16 bit
```

打包公式：

```text
key = ((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768)
```

- 必须使用普通 `number` 算术。
- 不使用 JavaScript 32-bit 位运算，避免高 32 bit 被截断。
- 该布局使 packed `number` 的升序与 `(x, y, z)` 字典序一致。

## 负坐标编码

使用 bias offset，不使用 two's complement：

```text
-32768 -> 0
-1     -> 32767
0      -> 32768
1      -> 32769
32767  -> 65535
```

- 每个坐标在打包前加上 `32768`，映射到 `0..65535`。
- 负坐标合法，不拒绝。
- bias offset 保持 signed 坐标的自然顺序。
- 不使用 two's complement，因为它会让负坐标在直接数值排序中落到非负坐标之后。

## 公开接口

```ts
export function pack(
  x: number,
  y: number,
  z: number,
): Result<VoxelKey, PackedIntError>;

export function unpack(
  key: VoxelKey,
): readonly [number, number, number];

export function compare(
  a: VoxelKey,
  b: VoxelKey,
): -1 | 0 | 1;

export function boundsCheck(
  x: number,
  y: number,
  z: number,
): boolean;

export function neighbor(
  key: VoxelKey,
  axis: "x" | "y" | "z",
  delta: number,
): Result<VoxelKey, PackedIntError>;
```

- `pack` 接收三个独立坐标，不接收对象或数组。
- `unpack` 返回 `readonly [x, y, z]` 元组。
- 不提供对象参数重载，也不提供两套重复 API。
- 本模块不依赖 `domain/voxel/voxel-types.ts`，因此不导入 `GridPosition`。
- 上层可以在 domain 边界把元组映射为 `GridPosition`。

## 解包

```ts
const z = key % 65536;
const y = Math.floor(key / 65536) % 65536;
const x = Math.floor(key / 4294967296) % 65536;

return [x - 32768, y - 32768, z - 32768] as const;
```

- `unpack` 的输入是已经验证的 `VoxelKey`。
- `unpack` 不返回 `Result`。
- 通过不安全类型断言传入非法 `number` 属于编程错误，不属于正常 `Result` 流程。
- 解包必须精确还原 `pack` 的坐标，包括负坐标和边界值。

## compare 排序规则

- `compare(a, b)` 按 `x`、`y`、`z` 依次比较。
- 返回值固定为 `-1 | 0 | 1`。
- 因为采用 x 高位、y 中位、z 低位和 bias offset，直接比较 packed `number` 即得到相同顺序。
- 不按 `z, y, x` 排序。
- 不允许依赖数组元素顺序或字符串排序。
- 所有需要稳定排序的 `VoxelKey` 集合都使用该顺序。

## boundsCheck

```ts
boundsCheck(x, y, z): boolean
```

- 三个坐标都在 `[-32768, 32767]` 内且都是有限整数时返回 `true`。
- 任一坐标非法时返回 `false`。
- 不返回 `Result`。
- 不抛异常。
- 不做 clamp。
- 需要知道具体哪个轴失败或需要错误详情时，调用 `pack` 并读取 `PackedIntError`。

## neighbor

```ts
neighbor(key, axis, delta): Result<VoxelKey, PackedIntError>
```

- 只提供 `neighbor(key, axis, delta)`，不额外提供 `neighbors6`。
- `axis` 只允许 `"x" | "y" | "z"`。
- `delta` 必须是有限安全整数；`delta = 0` 返回原键。
- 新坐标仍在支持范围内时返回成功键。
- 新坐标越界时返回 `coordinate_out_of_range`，不 wrap-around。
- `delta` 非法时返回 `invalid_delta`。
- 6/18/26 邻域由上层 `voxel-query.neighbors` 根据邻域定义调用该原语，不在本模块重复实现。

## 溢出与错误模型

可预期失败统一使用 `Result`，不抛业务异常，不静默截断或 clamp。

```ts
export type PackedIntError =
  | {
      readonly code: "invalid_coordinate";
      readonly axis: "x" | "y" | "z";
      readonly value: number;
    }
  | {
      readonly code: "coordinate_out_of_range";
      readonly axis: "x" | "y" | "z";
      readonly value: number;
      readonly min: number;
      readonly max: number;
    }
  | {
      readonly code: "invalid_delta";
      readonly value: number;
    };
```

- 坐标不是有限整数时返回 `invalid_coordinate`。
- 坐标超出 16-bit 范围时返回 `coordinate_out_of_range`。
- `neighbor` 的 `delta` 不是有限安全整数时返回 `invalid_delta`。
- `neighbor` 计算后的坐标越界时返回 `coordinate_out_of_range`。
- `pack` 失败时不返回部分结果，也不修改输入。
- 错误值必须是普通、可序列化、可判别数据。
- 不把原生 `Error` 作为正常业务失败值。

## 纯函数约束

- 所有公开函数均为纯函数。
- 不读取全局状态。
- 不修改输入。
- 不缓存或持有全局 `Map`。
- 不依赖 DOM、Worker、Three.js 或持久化 API。
- 不使用字符串拼接生成体素键。

**依赖**：`util/result`。
