# model-commands.ts

**职责**：定义 Edit 模式中活动 `VoxObject` 的模型整理、体素算法和测量操作的纯数据命令。

**接口**：
- 所有命令携带 `objectId: VoxObjectId` 和 `baseSceneVersion`；`objectId` 必须等于 `EditorState.activeObjectId`。
- `OptimizeVoxelsCommand`：`{ objectId; neighborhood: 6 | 18 | 26; baseSceneVersion; operationId? }`。
- `ResampleVoxelsCommand`：`{ objectId; factor?: number; targetResolution?: number; samplesPerAxis: 1 | 2 | 3; baseSceneVersion; operationId? }`；`factor` 与 `targetResolution` 必须且只能提供一个。
- `FillHolesCommand`：`{ objectId; fallbackColor: VoxelColor; closing: true; baseSceneVersion; operationId? }`。
- `NormalizeVoxelsCommand`、`CentralizeVoxelsCommand`：`{ objectId; baseSceneVersion; operationId? }`；只携带活动对象模型整理意图。
- `MeasureVolumeCommand`：`{ objectId; scope: CommandScope; baseSceneVersion }`；返回报告，不修改模型。
- `SymmetrizeModelCommand`、`MirrorModelCommand`、`RotateModelCommand`、`DeleteHalfModelCommand`：`{ objectId; axis: "x" | "y" | "z"; pivotMode: "bounds" | "world"; side?: 1 | -1; direction?: "cw" | "ccw"; baseSceneVersion }`；只作用于活动对象，XFORM 活动时 Mirror/Rotate 改用 voxel-transform-command 的 session 版本。
- `ModelCommand` 为上述命令的可辨识联合；metadata 统一包含 `id`、`baseSceneVersion`、`source`。

**内部**：
- 命令只携带不可变、可序列化参数；不携带 Worker、函数、`SceneDocument` 引用、补丁或结果数组。
- `baseSceneVersion` 在用户确认操作后冻结。Handler 发现版本变化必须返回 `stale-version`，不能把耗时算法结果套到新场景。
- `pivotMode = "bounds"` 使用活动对象局部占用包围盒中心；`pivotMode = "world"` 由 Handler 把场景世界原点 `(-0.5, -0.5, -0.5)` 通过绑定节点的逆世界变换解析为对象局部 pivot。命令不携带矩阵，领域函数不读取 SceneDocument。
- `operationId` 仅用于进度订阅和取消；取消不是模型数据，不能写入项目或 History。
- Normalize/Centralize/Optimize/Resample/Fill Holes 和模型级对称命令在派发前必须由 EditorSession 处理活动 Voxel XFORM；命令本身不读取 UI 的 Clone 或确认框状态。
- Measure Volume 是只读查询命令；空范围合法，不要求确认，不写 History。

**依赖**：scene-types、voxel-types、model-operations、util/color、util/result。
