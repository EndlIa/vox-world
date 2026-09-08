# color.ts

**职责**：定义与渲染器无关的领域颜色类型，负责十六进制颜色解析、规范化和 sRGB 线性化。
**接口**：`parseHex`、`toHex`、`linearize`、`srgbToLinear`、`equals`。
**内部**：领域颜色是无 alpha 的规范化 `#RRGGBB`；不持有 Three.js 类型；所有公开函数均为纯函数。
**依赖**：util/result。

## 公开类型

```ts
export type ColorHex = string & {
  readonly __brand: "ColorHex";
};

export type Rgb = Readonly<{
  r: number;
  g: number;
  b: number;
}>;

export type LinearRgb = Readonly<{
  r: number;
  g: number;
  b: number;
}>;
```

- `ColorHex` 是规范化后的领域颜色，格式固定为大写、带 `#` 的 `#RRGGBB`。
- `Rgb` 表示 sRGB 8-bit 通道；每个分量必须是有限整数，范围为 `0..255`。
- `LinearRgb` 表示线性 sRGB 通道；每个分量范围为 `0..1`。
- 三者都不包含 alpha。
- 只使用 TypeScript 的 `readonly` 表达不可变约束，不依赖运行时 `Object.freeze`。

## 公开接口

```ts
export function parseHex(input: string): Result<ColorHex, ColorParseError>;
export function toHex(rgb: Rgb): Result<ColorHex, ColorChannelError>;
export function linearize(color: ColorHex): LinearRgb;
export function srgbToLinear(channel: number): Result<number, ColorScalarError>;
export function equals(a: ColorHex, b: ColorHex): boolean;
```

- `parseHex` 解析并规范化输入字符串。
- `toHex` 把 8-bit sRGB 通道编码为规范化 `ColorHex`。
- `linearize` 把规范化 sRGB 颜色逐通道转换为 `LinearRgb`。
- `srgbToLinear` 是逐通道的底层转换函数。
- `equals` 比较两个已经规范化的领域颜色。

## 解析与规范化

- 接受可选的 `#` 前缀。
- 前缀之后必须恰好是 6 个十六进制字符。
- 接受大小写十六进制字母，输出统一转为大写。
- 输出始终带 `#`。
- 不接受 `#RGB`、4 位、8 位或任何带 alpha 的格式。
- 不接受前后空白、空字符串、非十六进制字符或额外字符。
- 不做自动 `trim`，也不进行宽松解析。

示例：

```text
#ffaa00 -> #FFAA00
ffaa00  -> #FFAA00
#F0A    -> invalid
#FFAA0080 -> invalid
```

`ColorHex` 只能由 `parseHex` 或 `toHex` 成功返回。生产代码不得用无检查的类型断言绕过解析；brand 仅用于让 TypeScript 追踪“已经验证并规范化”的字符串。

## Alpha 边界

- `color.ts` 只表示不透明的领域颜色。
- `ColorHex`、`Rgb` 和 `LinearRgb` 均不包含 alpha。
- 不接受 4 位或 8 位带 alpha 的 hex。
- UI 透明度、纹理 alpha、材质 opacity、透明导出格式和渲染混合属于各自边界层，不进入本模块。
- 需要 alpha 的调用方必须使用独立的透明度字段或更高层颜色类型。

## 错误模型

可预期失败统一使用 `Result`，不返回 `null`/`undefined`，也不主动抛出业务异常。

```ts
export type ColorParseError = Readonly<{
  code: "invalid_hex";
  input: string;
}>;

export type ColorChannelError = Readonly<{
  code: "invalid_rgb_channel";
  channel: "r" | "g" | "b";
  value: number;
}>;

export type ColorScalarError = Readonly<{
  code: "invalid_srgb_channel";
  value: number;
}>;

export type ColorError =
  | ColorParseError
  | ColorChannelError
  | ColorScalarError;
```

- 非法 hex 返回 `ColorParseError`，并保留原始输入。
- `toHex` 遇到非有限、非整数或超出 `0..255` 的通道时返回 `ColorChannelError`。
- `srgbToLinear` 遇到非有限或超出 `0..1` 的通道时返回 `ColorScalarError`。
- 不静默 clamp、截断、四舍五入或返回 `NaN`。
- 错误值必须是普通、可序列化、可判别数据；不得把原生 `Error` 作为跨边界错误值。

## sRGB 线性化

`srgbToLinear` 逐通道使用标准 sRGB EOTF：

```text
c <= 0.04045
  ? c / 12.92
  : ((c + 0.055) / 1.055) ^ 2.4
```

- 使用标准 sRGB 公式，不使用 gamma 2.2 近似。
- 只做逐通道转换，不做颜色平均、调色板合并、亮度计算或色彩分级。
- `linearize` 先把 `#RRGGBB` 解码为 8-bit 通道，再按 `channel / 255` 调用相同的转换规则。
- `linearize` 不负责纹理采样、GPU 缓冲、渲染器输出色彩空间、tonemapping、曝光或材质 alpha。
- 不提供反向 `linearToSrgb`；出现明确需求后再单独设计。
- 不实现 HSL/HSV 类型或转换函数，也不创建占位 API；UI 颜色轮盘可以在上层使用临时 HSL/HSV 状态，但提交到领域前必须规范化为 `ColorHex`。

## 相等与不可变性

- `equals(a, b)` 使用规范化 `ColorHex` 的精确字符串比较。
- 不进行浮点近似，不引入 epsilon。
- 因为 `ColorHex` 已保证大写和 `#` 前缀，大小写与前缀差异不会进入比较。
- 所有函数不修改输入，`linearize` 返回新的只读 `LinearRgb` 对象。
- 不提供 in-place、out 参数或 class builder API。

## Three.js 对齐约束

- `color.ts` 不依赖 Three.js，也不依赖其他领域模块。
- sRGB 转换公式和边界行为必须与 Three.js 对应的 sRGB 色彩空间规则一致。
- Three.js `Color`、纹理色彩空间和渲染器输出色彩空间只允许在基础设施/渲染适配层处理。
- Three.js 只允许作为测试期 `devDependency`，用于对关键转换做一致性测试。
- 生产代码不得导入 Three.js。

**依赖**：util/result。
