# model-commands.ts

**职责**：定义模型整理、体素算法和测量操作的纯数据命令。

**接口**：
- `OptimizeVoxelsCommand`：`{ neighborhood: 6 | 18 | 26; baseVersion; operationId? }`。
- `ResampleVoxelsCommand`：`{ factor?: number; targetResolution?: number; samplesPerAxis: 1 | 2 | 3; baseVersion; operationId? }`；`factor` 与 `targetResolution` 必须且只能提供一个。
- `FillHolesCommand`：`{ fallbackColor: VoxelColor; closing: true; baseVersion; operationId? }`。
- `NormalizeVoxelsCommand`、`CentralizeVoxelsCommand`：`{ baseVersion; operationId? }`；只携带模型整理意图。
- `MeasureVolumeCommand`：`{ scope: CommandScope; baseVersion }`；返回报告，不修改模型。
- `SymmetrizeModelCommand`、`MirrorModelCommand`、`RotateModelCommand`、`DeleteHalfModelCommand`：`{ axis: "x" | "y" | "z"; pivotMode: "bounds" | "world"; side?: 1 | -1; direction?: "cw" | "ccw"; baseVersion }`；分别对应模型级对称操作，XFORM 活动时 Mirror/Rotate 改用 transform-command 的 session 版本。
- `ModelCommand` 为上述命令的可辨识联合；metadata 统一包含 `id`、`baseVersion`、`source`。

**内部**：
- 命令只携带不可变、可序列化参数；不携带 Worker、函数、`VoxelDocument` 引用、补丁或结果数组。
- `baseVersion` 在用户确认操作后冻结。Handler 发现版本变化必须返回 `stale-version`，不能把耗时算法结果套到新模型。
- `operationId` 仅用于进度订阅和取消；取消不是模型数据，不能写入项目或 History。
- Normalize/Centralize/Optimize/Resample/Fill Holes 和模型级对称命令在派发前必须由 EditorSession 处理活动 XFORM；命令本身不读取 UI 的 NEW SCENE、Clone 或确认框状态。
- Measure Volume 是只读查询命令；空范围合法，不要求确认，不写 History。

**依赖**：voxel-types、model-operations、util/color、util/result。
