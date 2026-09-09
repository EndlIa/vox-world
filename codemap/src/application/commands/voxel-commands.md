# voxel-commands.ts

**职责**：定义 Edit 模式中活动 `VoxObject` 内建模、绘制、填充、颜色组和可见性编辑的纯数据命令。

**接口**：
- `VoxelCommand` 可辨识联合：`AddVoxelsCommand`、`RemoveVoxelsCommand`、`PaintVoxelsCommand`、`SetVisibilityCommand`、`InvertVisibilityCommand`、`DeleteHiddenCommand`、`GroupByIslandsCommand`。
- 每个命令都携带 `objectId: VoxObjectId` 和 `baseSceneVersion`；`objectId` 必须等于当前 `EditorState.activeObjectId`。
- `AddVoxelsCommand`：`{ objectId; intent: AddIntent; color: VoxelColor; overwrite: "skip-existing" | "overwrite"; symmetry: SymmetrySnapshot; workplane: WorkplaneSnapshot; baseSceneVersion }`。
- `AddIntent`：`positions`、`bridge`、`box`、`rectangle`、`coordinate` 五类纯数据。
  - `positions`：去重后的目标网格位置；用于 Freehand、Bucket 和已解析的对称位置。
  - `bridge`：`start`、唯一非零轴向 `direction`、`bypass`、`modelBounds`；终点由 Handler 按占用和边界解析。
  - `box`：闭区间 `bounds`、`mode: "fill" | "wall"`、`fixedHeight`；`wall` 仅用于 Add Wall。
  - `rectangle`：用于 Rectangle Add/Remove/Paint；携带 `screenRect`、`projectedKeys`、`surfaceKeys`、`bypass`；`bypass = false` 时 Handler 只保留表面键。
  - `coordinate`：恰好三个十进制整数解析出的 `x`、`y`、`z`，已占用位置按 `skip-existing` 处理。
- `RemoveVoxelsCommand`：`{ objectId; intent: RemoveIntent; symmetry?: SymmetrySnapshot; baseSceneVersion }`；intent 支持 `positions`、`box`、`rectangle`、`color`、`selection`、`hidden`。
- `PaintVoxelsCommand`：`{ objectId; intent: PaintIntent; color: VoxelColor; symmetry?: SymmetrySnapshot; baseSceneVersion }`；intent 支持 `positions`、`box`、`rectangle`、`bucket-color`、`bucket-island`、`paint-all`。
  - `bucket-color` 携带拾取颜色；`bucket-island` 携带种子键和 `connectivity: 6 | 26`。
  - `paint-all` 表示把活动对象的全部体素改成当前颜色并全部设为可见，是一个原子命令。
- `SetVisibilityCommand`：`{ objectId; target: VisibilityTarget; visible?: boolean; baseSceneVersion }`；target 支持 `keys`、`color`、`all`、`slice-y`、`isolate-color`。前四类必须携带 `visible`；`isolate-color` 固定为目标色可见、其余全部隐藏。
  - `VisibilityTarget` 为可辨识联合：`{ kind: "keys"; keys }`、`{ kind: "color"; color }`、`{ kind: "all" }`、`{ kind: "slice-y"; sliceY }`、`{ kind: "isolate-color"; color }`。
  - `slice-y` 携带整数 `sliceY`：`0` 表示全部可见，正数表示 `y = sliceY - 1`，负数表示 `y = sliceY`。
  - `isolate-color` 在一个命令中先把活动对象的全部体素设为隐藏，再只显示指定颜色组。
- `DeleteHiddenCommand`：`{ objectId; baseSceneVersion }`；删除活动对象中当前 `visible === false` 的体素。
- `InvertVisibilityCommand`：`{ objectId; baseSceneVersion }`；对应 Invert Visibility，翻转活动对象全部体素的可见性，并生成一个可逆 Patch。
- `GroupByIslandsCommand`：`{ objectId; connectivity: 6 | 26; seed: number; unhideAll: true; operationId?; baseSceneVersion }`；按活动对象内的连通岛屿重新分配颜色，不携带随机函数或颜色数组。
- 所有命令的 metadata 至少包含 `id`、`baseSceneVersion` 和 `source`；命令对象不可变、可序列化。

**内部**：
- 命令只表达意图，不读取 `SceneDocument`、Selection、TransformSession 或渲染结果，也不计算最终 Patch。
- 命令只能在 Edit 模式下执行；Handler 必须验证 `objectId === EditorState.activeObjectId`。非活动对象的体素键、颜色、范围或屏幕候选一律不得进入执行路径。
- `projectedKeys`、`surfaceKeys` 和 `positions` 必须是普通数组/只读集合；不得包含 Three.js 对象、PickResult 实例、函数或 DOM 节点。
- 对称轴、pivot 模式、Bypass、Add Wall 高度、Island 连通性和 workplane 策略在 `pointerDown` 时冻结进命令；手势中 UI 变化只影响下一次手势。
- `baseSceneVersion` 在命令创建时冻结；Handler 发现场景版本不一致必须返回 `stale-version`，不能把命令重放到新场景。
- Bridge 的命令不包含预先算好的路径，避免绕过状态校验；路径只能由 Handler 在活动对象的只读局部视图上解析。
- Paint All、Group by Islands、Delete Hidden 和 Isolate Color 只作用于活动对象，并且各自只产生一个命令、一个事务和一个历史项。
- 颜色组没有独立持久化 ID；`color` 字段就是颜色组身份。按颜色隐藏、隔离、删除、变换或复制分别复用可见性、删除、选择与 XFORM 命令。

**依赖**：scene-types、voxel-types、symmetry、util/color、util/math。
