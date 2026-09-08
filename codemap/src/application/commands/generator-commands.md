# generator-commands.ts

**职责**：定义 Box、Plane、Isometric、Sphere 和 Terrain 生成命令的纯数据契约。

**接口**：
- `GenerateVoxelsCommand`：`{ spec: GeneratorSpec; placement: "new-scene" | "xform-new"; baseVersion; operationId? }`。
- `GenerateBoxCommand`、`GeneratePlaneCommand`、`GenerateIsometricCommand`、`GenerateSphereCommand`、`GenerateTerrainCommand` 可作为 `GenerateVoxelsCommand` 的窄化别名，payload 只包含对应 `GeneratorSpec`。
- `placement = "new-scene"` 对应 NEW SCENE 开启：成功结果替换当前模型的体素集合，单个事务/历史项。
- `placement = "xform-new"` 对应 NEW SCENE 关闭：生成结果先作为 `sourceKind = "new"` 的 XFORM 会话预览，不立即写入文档。
- 命令 metadata 至少包含 `id`、`baseVersion`、`source`；颜色、尺寸、半径、渐变和 seed 均为可序列化普通数据。

**内部**：
- 命令不携带生成函数、Three.js SimplexNoise 实例、DOM 控件、Worker 对象或生成后的可变数组；Terrain 的噪声由 Handler/领域实现按 seed 构造。
- 所有尺寸、半径、颜色和 seed 在命令创建时冻结；UI 后续变化只影响下一次命令。
- 命令不自行判断是否先 Apply XFORM；EditorSession 在派发前统一处理活动会话，避免生成结果插入未提交的 working entries。
- `baseVersion` 用于 NEW SCENE 替换时的陈旧版本检查；`operationId` 可选用于绑定进度和取消，不得放进持久化项目。

**依赖**：generator、voxel-types、util/color、util/result。
