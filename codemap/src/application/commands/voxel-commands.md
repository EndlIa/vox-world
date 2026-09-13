# voxel-commands.ts

**职责**：定义 Edit 模式中活动 `SceneObject` 内建模、绘制、填充、颜色组和可见性编辑的纯数据命令。

**接口**：
- `VoxelCommand` 可辨识联合：`AddVoxelsCommand`、`RemoveVoxelsCommand`、`PaintVoxelsCommand`；`SetVisibilityCommand`、`InvertVisibilityCommand`、`DeleteHiddenCommand`【暂不实现】（可见性编辑）；`GroupByIslandsCommand`【暂不实现】（连通性）。
- 每个命令都携带 `sceneObjectId: SceneObjectId` 和 `baseSceneVersion`；`sceneObjectId` 必须等于当前 `EditorState.activeSceneObjectId`。
- `AddVoxelsCommand`：`{ sceneObjectId; addressing: Addressing; color: ColorHex; overwrite: "skip-existing" | "overwrite"; boxMode?: "fill" | "wall"; fixedHeight?: number; symmetry: SymmetrySnapshot; workplane: WorkplaneSnapshot; baseSceneVersion }`；字段 `symmetry`【暂不实现】。
- `RemoveVoxelsCommand`：`{ sceneObjectId; addressing: Addressing; symmetry?: SymmetrySnapshot; baseSceneVersion }`；字段 `symmetry`【暂不实现】。
- `PaintVoxelsCommand`：`{ sceneObjectId; addressing: Addressing; color: ColorHex; symmetry?: SymmetrySnapshot; baseSceneVersion }`；字段 `symmetry`【暂不实现】。
- 【暂不实现】（整块）`SetVisibilityCommand`：`{ sceneObjectId; addressing: Addressing; visible: boolean; isolate?: true; baseSceneVersion }`；`visible` 必填；`isolate` 仅在寻址解析为 `{ kind: "color" }` 时合法，表示在同一次原子提交中把活动对象全部体素设为隐藏、再把目标颜色组设为可见。
- `Addressing`：命令的寻址部分，`kind` 判别的可辨识联合。`scope` 变体直接携带唯一的寻址类型 `VoxelScope`；其余变体是需要 Handler 解析的交互输入：
  - `{ kind: "scope"; scope: VoxelScope }`：已可寻址。`keys` 用于 Freehand、Bucket 与已解析的对称位置【暂不实现】；`bounds` 用于 Box Add/Remove/Paint；`color` 用于颜色组与 Bucket 取色；`all` 用于 Paint All；`visible`/`hidden`/`slice-y`【暂不实现】。
  - `{ kind: "bridge"; start; direction; bypass; modelBounds }`：终点与路径由 Handler 按占用和边界解析，命令不携带预先算好的路径。
  - `{ kind: "rectangle"; screenRect; projectedKeys; surfaceKeys; bypass }`：用于 Rectangle Add/Remove/Paint；`bypass = false` 时 Handler 只保留表面键。
  - `{ kind: "coordinate"; x; y; z }`：恰好三个十进制整数解析出的坐标，已占用位置按 `skip-existing` 处理。
  - `{ kind: "selection" }`：当前 `VoxelSelection` 的局部键集合，由 Handler 从状态解析（命令自身不携带键）。
  - 【暂不实现】`{ kind: "bucket-island"; seed; connectivity: 6 | 26 }`（依赖 `Connectivity`）。
- `boxMode`/`fixedHeight` 只在寻址解析为 `{ kind: "bounds" }` 时合法（`wall` 仅用于 Add Wall），其他寻址不得携带；不得为寻址恢复 `BoxSpec` 之类的第二套类型。
- 【暂不实现】`DeleteHiddenCommand`：`{ sceneObjectId; baseSceneVersion }`；删除活动对象中当前 `visible === false` 的体素。
- 【暂不实现】`InvertVisibilityCommand`：`{ sceneObjectId; baseSceneVersion }`；对应 Invert Visibility，翻转活动对象全部体素的可见性，并生成一个可逆 Patch。
- 【暂不实现】`GroupByIslandsCommand`：`{ sceneObjectId; connectivity: 6 | 26; seed: number; unhideAll: true; operationId?; baseSceneVersion }`；按活动对象内的连通岛屿重新分配颜色，不携带随机函数或颜色数组。
- 所有命令的 metadata 至少包含 `id`、`baseSceneVersion` 和 `source`；命令对象不可变、可序列化。

**内部**：
- 命令只表达意图，不读取 `SceneDocument`、Selection、TransformSession 或渲染结果，也不计算最终 Patch。
- 命令只能在 Edit 模式下执行；Handler 必须验证 `sceneObjectId === EditorState.activeSceneObjectId`。非活动对象的体素键、颜色、范围或屏幕候选一律不得进入执行路径。
- `projectedKeys`、`surfaceKeys` 与 `VoxelScope.keys` 必须是普通数组/只读集合；不得包含 Three.js 对象、PickResult 实例、函数或 DOM 节点。
- 对称轴、pivot 模式（【暂不实现】）、Bypass、Add Wall 高度、Island 连通性（【暂不实现】）和 workplane 策略在 `pointerDown` 时冻结进命令；手势中 UI 变化只影响下一次手势。
- `baseSceneVersion` 在命令创建时冻结；Handler 发现场景版本不一致必须返回 `stale-version`，不能把命令重放到新场景。
- Bridge 的命令不包含预先算好的路径，避免绕过状态校验；路径只能由 Handler 在活动对象的只读局部视图上解析。
- Paint All（`{ kind: "scope"; scope: { kind: "all" } }`）只作用于活动对象，并且只产生一个命令、一个事务和一个历史项；Group by Islands、Delete Hidden、`SetVisibilityCommand` 的 `isolate`【暂不实现】。
- `Addressing` 的解析归 Handler：`scope` 变体经 `query` 解析为该对象的局部键集，`bridge`/`rectangle`/`coordinate` 按各自规则解析，`selection` 读取当前 `VoxelSelection`。所有解析结果必须全是活动对象的局部键；跨对象键拒绝。
- 颜色组没有独立持久化 ID；`color` 字段就是颜色组身份。按颜色隐藏、隔离、删除、变换或复制分别复用可见性、删除、选择与 XFORM 命令（其中“按颜色隐藏/隔离”【暂不实现】）。

**依赖**：scene-types、voxel/uniform/types、util/color、util/math（`domain/voxel/uniform/symmetry`【暂不实现】）。
