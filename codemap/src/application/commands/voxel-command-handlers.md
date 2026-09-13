# voxel-command-handlers.ts

**职责**：解释活动 `SceneObject` 内的体素编辑、颜色组和可见性命令，并生成可逆、原子、稳定的对象级 `VoxelPatch` 或 `ScenePatch`。

**接口**：
- `AddVoxelsHandler`、`RemoveVoxelsHandler`、`PaintVoxelsHandler`；`SetVisibilityHandler`、`InvertVisibilityHandler`【暂不实现】。
- `DeleteHiddenHandler`、`GroupByIslandsHandler`【暂不实现】。
- 每个 Handler 实现 `canHandle`、`validate(command, context)`、`execute(command, context) -> CommandOutcome`；context 只提供只读文档/选择快照、查询、颜色规范化、显式注入的随机种子和 WorkerPort；对称规则【暂不实现】。

**内部**：
- 通用门禁：EditorState 必须处于 Edit 模式，`command.sceneObjectId` 必须等于 `activeSceneObjectId`，对象必须存在；然后校验 `baseSceneVersion` 和所有局部整数范围。
- 通用提交规则：Handler 先把 `command.addressing` 解析为该对象的局部键集（`scope` 变体经 `query`，`bridge`/`rectangle`/`coordinate` 按各自规则，`selection` 读取当前 `VoxelSelection`），所有候选只在活动对象的局部视图中解析，按稳定 `VoxelKey` 去重、排序；Handler 返回绑定该对象的 `ScenePatch.applySceneObjectVoxelPatch`，不直接修改 `SceneDocument`、Selection、History、渲染器或 UI。
- Add：
  - `scope.kind = "keys"` 直接使用候选，重复键只写一次；对称 Add 展开镜像位置【暂不实现】。
  - `bridge` 必须恰好有一个非零轴向方向。未开启 Bypass 时遇到占用体素立即停止；开启后允许穿过占用，但始终不得越过 `modelBounds`。桥本身只写入空位置，不覆盖已有体素，并在一次 Patch 中提交整条路径。
  - `scope.kind = "bounds"`（即 Add 的 `boxMode` 生效处）使用闭区间；`fill` 写入全部整数格，`wall` 仅用于 Add Wall，把 Y 范围固定为 `start.y .. start.y + fixedHeight - 1`，X/Z 仍由拖拽范围决定。范围体积超过配置上限时返回 `range-too-large`，禁止只提交部分范围。
  - `rectangle` 使用屏幕投影候选；`bypass = false` 时与 `surfaceKeys` 求交，`true` 时保留全部深度候选。投影和去重完成后才生成 Patch；对称展开【暂不实现】。
  - `coordinate` 要求输入恰好解析为 `x,y,z` 三个整数，且每轴落在 `MIN_COORDINATE..MAX_COORDINATE` 内（越界拒绝，不 clamp）；已占用位置按 `skip-existing` 忽略，不产生覆盖通知。
  - Add 默认 `skip-existing`；只有显式覆盖模式才允许替换颜色（可见性【暂不实现】），并在结果中返回 `overwritten` 计数。
- Remove：
  - `scope.kind = "keys"|"bounds"`、`selection` 和 `rectangle` 只删除已存在键；隐藏体素的参与规则【暂不实现】（Box/Rect 的“默认只处理可见体素”随可见性一并挂起）。
  - `scope.kind = "color"` 删除活动对象中精确同色的全部体素，（“包括隐藏体素”【暂不实现】）；`scope.kind = "hidden"`【暂不实现】与 `DeleteHiddenCommand` 等价。
  - 【暂不实现】对称 Remove 只删除实际存在的镜像目标，不创建或恢复体素。
- Paint：
  - `scope.kind = "keys"|"bounds"` 与 `rectangle` 只对已存在键改色；同一键在同一次提交中只保留最后一次颜色。对称 Paint 的镜像写入【暂不实现】。
  - `scope.kind = "color"`（Bucket 取色）读取种子体素的规范化颜色，把颜色组全部体素改成当前颜色，不按岛屿拆分。
  - 【暂不实现】`bucket-island` 从种子体素执行连通遍历；`connectivity = 6` 使用轴向邻居，`26` 使用轴向加边/角邻居；默认只跨可见体素，隐藏体素阻断连通。不存在或隐藏的种子返回空 Patch。
  - `scope.kind = "all"`（Paint All）把活动对象的全部体素改成当前颜色；设为 `visible = true` 与隐藏状态修正【暂不实现】；合并为单个 `replaceAll` 或等价 Patch。
- 【暂不实现】Visibility：
  - `scope.kind = keys/color/all`（`slice-y`【暂不实现】）只修改 `visible`，绝不删除体素；Slice Y 严格使用 `0 => all`、正数 `sliceY - 1`、负数 `sliceY` 的规则。
  - `isolate` 修饰在同一 Patch 中把活动对象的全部体素设隐藏、再把精确颜色组设可见；颜色比较使用规范化大写 `#RRGGBB`。
  - `InvertVisibilityCommand` 一次翻转活动对象全部体素的可见性；空对象返回空 Patch。
  - `DeleteHiddenCommand` 只删除隐藏键；空集合返回空 Patch，不写历史。
- 【暂不实现】`GroupByIslands`：
  - 【暂不实现】先解除全部隐藏，再按 6 或 26 邻域计算连通分量；分量排序使用最小 `VoxelKey`，保证结果稳定。
  - 每个岛屿分配一个唯一颜色，排除 `#000000` 和 `#FFFFFF`；颜色由 `seed + 稳定岛屿序号` 确定性生成，碰撞时继续推进，避免测试和重做结果漂移。
  - 所有体素保留原位置（“设为可见”【暂不实现】），颜色变更合成单个 Patch；超过 inline 阈值时通过 WorkerPort 处理纯快照，`operationId` 只用于进度/取消，Worker 原始消息不得直接提交。
- 失败与取消：`stale-version`、`edit-mode-required`、`active-object-mismatch`、非法范围、非法方向、空结果和取消均不生成 Patch、不递增场景版本、不写 History；已开始的异步操作只能由 WorkerPort 取消，Handler 不得留下半提交状态。

**依赖**：voxel-commands、scene-types、scene-patch、scene-document、editor-state、state/voxel/uniform/voxel-selection、domain/voxel/uniform/symmetry、domain/voxel/uniform/query、domain/voxel/uniform/patch、domain/voxel/uniform/model-operations、worker-port、util/color、util/packed-int、util/result（`domain/voxel/uniform/symmetry`【暂不实现】）。
