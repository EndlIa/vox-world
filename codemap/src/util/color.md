# color.ts

**职责**：定义与渲染器无关的领域颜色类型，负责十六进制颜色解析、规范化和 sRGB 线性化。
**接口**：`parseHex`、`parseRgb`、`toHex`、`linearize`、`srgbToLinear`、`equals`。
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
}> & {
  readonly __brand: "Rgb";
};

export type LinearRgb = Readonly<{
  r: number;
  g: number;
  b: number;
}> & {
  readonly __brand: "LinearRgb";
};
```

- `ColorHex` 是规范化后的领域颜色，格式固定为大写、带 `#` 的 `#RRGGBB`。
- `Rgb` 表示 sRGB 8-bit 通道；每个分量必须是有限整数，范围为 `0..255`。
- `LinearRgb` 表示线性 sRGB 通道；每个分量范围为 `0..1`。
- `Rgb` 与 `LinearRgb` 形同名不同，必须带各自 brand，互相不可赋值；禁止互相别名、合并或声明同形副本。brand 只用于让 TypeScript 追踪“已经过校验”和“处于哪个色彩空间”，运行时仍是普通对象。
- `Rgb` 只能由 `parseRgb` 成功返回；`LinearRgb` 只能由 `linearize` 返回。两者都不提供公开的 unchecked cast，调用方不得用类型断言就地构造带 brand 的值；新增其他构造入口必须先在本契约登记。
- 三者都不包含 alpha。
- 只使用 TypeScript 的 `readonly` 表达不可变约束，不依赖运行时 `Object.freeze`。

## 公开接口

```ts
export function parseHex(input: string): Result<ColorHex, ColorParseError>;
export function parseRgb(
  rgb: Readonly<{ r: number; g: number; b: number }>,
): Result<Rgb, ColorChannelError>;
export function toHex(rgb: Rgb): ColorHex;
export function linearize(color: ColorHex): LinearRgb;
export function srgbToLinear(channel: number): Result<number, ColorScalarError>;
export function equals(a: ColorHex, b: ColorHex): boolean;
```

- `parseHex` 解析并规范化输入字符串。
- `parseRgb` 校验 8-bit sRGB 通道并构造带 brand 的 `Rgb`，是 `Rgb` 的唯一构造入口。
- `toHex` 把已经通过 `parseRgb` 校验的 `Rgb` 编码为规范化 `ColorHex`；因为 `Rgb` 的合法性由构造入口保证，`toHex` 不返回 `Result`。
- `linearize` 把规范化 sRGB 颜色逐通道转换为 `LinearRgb`，是 `LinearRgb` 的唯一构造入口。
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

`ColorHex` 只能由 `parseHex` 或 `toHex` 返回。生产代码不得用无检查的类型断言绕过解析；brand 仅用于让 TypeScript 追踪“已经验证并规范化”的字符串。

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
- `parseRgb` 遇到非有限、非整数或超出 `0..255` 的通道时返回 `ColorChannelError`。
- `srgbToLinear` 遇到非有限或超出 `0..1` 的通道时返回 `ColorScalarError`。
- 多个通道同时非法时，**报告哪一个通道未定义**：本模块不承诺校验顺序，调用方不得依赖 `error.channel` 推断“哪个输入先出错”；需要按通道给出输入级反馈时，由调用方逐通道自行校验。
- `toHex` 不产生错误：它的输入 `Rgb` 已由 `parseRgb` 保证合法。
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
- 测试可以使用 Three.js `Color` 的显式色彩空间 API（例如传入 `SRGBColorSpace`，读取 `LinearSRGBColorSpace`）作为独立 oracle，验证 `sRGB → Linear-sRGB` 传输函数以及字节↔hex 编码的一致性。Three.js 在这些 API 内部通过 `ColorManagement` 执行转换；测试无需显式导入或配置 `ColorManagement`，除非正在验证其专门的全局配置行为。
- Three.js 对齐是测试验证手段，不改变本模块的领域边界：`parseRgb`、`toHex`、`srgbToLinear` 和 `linearize` 的公开语义由本契约中的类型、公式和错误模型定义。
- 对齐只覆盖传输函数与字节↔hex 编码。本模块的解析规则有意比 Three.js 的 CSS 解析器更严格：Three.js 还接受 `#RGB`、颜色名、`rgb()`/`hsl()` 和百分数；本模块只接受 6 位 hex，不得为了“贴近 Three.js”而放宽 `parseHex`。
- 差分测试使用与标准 sRGB 公式相称的严格浮点容差，并应足以发现公式、分支阈值或字节编码错误；容差不应放宽到掩盖实现错误。具体容差和扫描范围属于测试实现，不是本领域接口契约。
- 生产代码不得导入 Three.js。

**依赖**：util/result。
