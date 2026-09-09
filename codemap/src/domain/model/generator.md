# generator.ts

**职责**：用纯整数规则生成 Box、Plane、Isometric、Sphere 和 Terrain 体素快照。

**接口**：
- `GeneratorSpec` 可辨识联合：`BoxGeneratorSpec`、`PlaneGeneratorSpec`、`IsometricGeneratorSpec`、`SphereGeneratorSpec`、`TerrainGeneratorSpec`。
- `validateGeneratorSpec(spec) -> Result<void>`、`estimateVoxelCount(spec) -> number`、`generate(spec, options?) -> VoxelSnapshot`。
- `TerrainOptions`：`noise: Noise2D`、`heightGradient`、`palette`；`Noise2D` 只返回有限数，默认实现必须是确定性的种子噪声，不得依赖 Three.js 或全局随机数。
- 所有 spec 字段均为普通数字、字符串和布尔值，可直接序列化/结构化克隆；生成结果按 `VoxelKey` 排序。

**内部**：
- 生成器只产生一个 `VoxObject` 的局部 `VoxelSnapshot`，不创建 SceneNode、不决定对象世界变换，也不修改当前场景。
- 通用坐标规则：所有尺寸为安全正整数；体素坐标从 `0` 开始，范围为 `0 .. size - 1`；颜色默认传入的 `VoxelColor`，可见性一律为 `true`。空尺寸、非整数、超上限或会导致内存溢出的 spec 返回 `invalid-generator-spec`，不生成部分结果。
- Box Generator：`{ width, height, depth, mode: "fill" | "shell" }`。`fill` 生成完整闭区间；`shell` 只保留 `x == 0 || y == 0 || z == 0 || x == width - 1 || y == height - 1 || z == depth - 1` 的体素。Plane Generator 是 `height = 1` 的 Box，尺寸和颜色语义相同。
- Isometric：`{ width, height, depth }`，只生成 `x == 0 || y == 0 || z == 0` 的体素；不生成远端三个面。
- Sphere：`{ outerRadius, innerRadius, coloredCore, surfaceColor, coreColor }`。`outerRadius >= 3`；有效内半径按 `max(0, min(inputInnerRadius, outerRadius - 1) - 1)` 计算，保持 shithill 的 `inner -= 1` 语义。中心为 `c = outerRadius - 1`，坐标为 `0 .. outerRadius - 1`，距离平方使用 `dx = 2*x - c`、`dy = 2*y - c`、`dz = 2*z - c`。`innerR2 <= rr <= outerR2` 生成表面；`coloredCore` 为真时 `rr <= innerR2` 再生成内芯，颜色使用 `coreColor`。同一位置只保留一次，内芯颜色优先。
- Terrain：`{ width, depth, height, heightGradient, color, lowColor, highColor, seed }`。对每个 `(x,z)` 计算 `xoff = 0.17 * x / height`、`zoff = 0.17 * z / height`、`noiseValue = noise3d(xoff, 0, zoff)`；高度 `h = trunc(noiseValue * height)`，`trunc` 为向零取整。每列只生成 `(x, h, z)` 一个体素，允许 `h < 0`；`heightGradient = false` 使用 `color`，为真时按高度从 `lowColor`/`highColor` 的固定调色板取色。相同 seed 和尺寸必须产生相同快照。
- `estimateVoxelCount` 用于执行前内存保护；Terrain 至少为 `width * depth`，Sphere/Box/Isometric 按包围盒上界估算。超过配置上限时 Handler 必须拒绝或转 Worker，不得先分配完整数组再失败。
- 生成器不读取 `SceneDocument`、Selection、TransformSession、渲染状态或 UI；它只返回局部快照，是创建新 `VoxObject`、替换活动对象体素还是进入对象 XFORM 由 application 命令决定。
- 结果不得修改输入 spec；颜色统一规范化为大写 `#RRGGBB`，坐标按稳定键排序。

**依赖**：scene-types、voxel-types、util/color、util/math、util/result。
