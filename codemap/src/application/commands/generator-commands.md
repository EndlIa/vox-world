# generator-commands.ts

**职责**：定义 Box、Plane、Isometric、Sphere 和 Terrain 生成命令的纯数据契约。

**接口**：
- `GenerateVoxelsCommand`：`{ spec: GeneratorSpec; placement: "new-object" | "active-object-xform"; name?; parentNodeId?; transform?; baseSceneVersion; operationId? }`。
- `GenerateBoxCommand`、`GeneratePlaneCommand`、`GenerateIsometricCommand`、`GenerateSphereCommand`、`GenerateTerrainCommand` 可作为 `GenerateVoxelsCommand` 的窄化别名，payload 只包含对应 `GeneratorSpec`。
- `placement = "new-object"` 在 Object 模式下创建一个新的 `SceneNode + VoxObject`；`parentNodeId` 默认为根节点，`transform` 默认为单位变换。
- `placement = "active-object-xform"` 在 Edit 模式下把生成结果作为活动对象的 `sourceKind = "new"` Voxel XFORM 预览，不立即写入对象体素。
- 命令 metadata 至少包含 `id`、`baseSceneVersion`、`source`；颜色、尺寸、半径、渐变和 seed 均为可序列化普通数据。

**内部**：
- 命令不携带生成函数、Three.js SimplexNoise 实例、DOM 控件、Worker 对象或生成后的可变数组；Terrain 的噪声由 Handler/领域实现按 seed 构造。
- 所有尺寸、半径、颜色和 seed 在命令创建时冻结；UI 后续变化只影响下一次命令。
- 命令不自行判断是否先 Apply XFORM；EditorSession 在派发前统一处理活动会话，避免生成结果插入未提交的 working entries。
- `baseSceneVersion` 用于对象创建或活动对象 XFORM 的陈旧版本检查；`operationId` 可选用于绑定进度和取消，不得放进持久化项目。
- `new-object` 必须处于 Object 模式；`active-object-xform` 必须处于 Edit 模式且目标就是活动对象。命令不得隐式切换模式。

**依赖**：scene-types、generator、voxel-types、util/color、util/result。
