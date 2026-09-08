# voxel-command-handlers.ts

**职责**：解释体素编辑、颜色组和可见性命令，并生成可逆、原子、稳定的 `VoxelPatch`。

**接口**：
- `AddVoxelsHandler`、`RemoveVoxelsHandler`、`PaintVoxelsHandler`、`SetVisibilityHandler`、`InvertVisibilityHandler`。
- `DeleteHiddenHandler`、`GroupByIslandsHandler`。
- 每个 Handler 实现 `canHandle`、`validate(command, context)`、`execute(command, context) -> CommandOutcome`；context 只提供只读文档/选择快照、查询、颜色规范化、对称规则、显式注入的随机种子和 WorkerPort。

**内部**：
- 通用提交规则：先校验 `baseVersion` 和所有整数范围，再解析候选；所有候选按稳定 `VoxelKey` 去重、排序；Handler 只返回 Patch，不直接修改 `VoxelDocument`、Selection、History、渲染器或 UI。
- Add：
  - `positions` 直接使用候选；对称 Add 同时加入原位置和镜像位置，重复键只写一次。
  - `bridge` 必须恰好有一个非零轴向方向。未开启 Bypass 时遇到占用体素立即停止；开启后允许穿过占用，但始终不得越过 `modelBounds`。桥本身只写入空位置，不覆盖已有体素，并在一次 Patch 中提交整条路径。
  - `box` 使用闭区间；`fill` 写入全部整数格，`wall` 仅用于 Add Wall，把 Y 范围固定为 `start.y .. start.y + fixedHeight - 1`，X/Z 仍由拖拽范围决定。范围体积超过配置上限时返回 `range-too-large`，禁止只提交部分范围。
  - `rectangle` 使用屏幕投影候选；`bypass = false` 时与 `surfaceKeys` 求交，`true` 时保留全部深度候选。投影、对称和去重完成后才生成 Patch。
  - `coordinate` 要求输入恰好解析为 `x,y,z` 三个安全整数；已占用位置按 `skip-existing` 忽略，不产生覆盖通知。
  - Add 默认 `skip-existing`；只有显式覆盖模式才允许替换颜色/可见性，并在结果中返回 `overwritten` 计数。
- Remove：
  - `positions`、`box`、`selection` 和 `rectangle` 只删除已存在键；隐藏体素是否参与由命令来源明确决定，Box/Rect 默认只处理可见体素。
  - `color` 删除精确同色的全部体素，包括隐藏体素；`hidden` 与 `DeleteHiddenCommand` 等价。
  - 对称 Remove 只删除实际存在的镜像目标，不创建或恢复体素。
- Paint：
  - `positions`、`box`、`rectangle` 只对已存在键改色；同一键在同一次提交中只保留最后一次颜色。对称 Paint 只在镜像目标已存在时写入。
  - `bucket-color` 读取种子体素的规范化颜色，把颜色组全部体素改成当前颜色，不按岛屿拆分。
  - `bucket-island` 从种子体素执行连通遍历；`connectivity = 6` 使用轴向邻居，`26` 使用轴向加边/角邻居；默认只跨可见体素，隐藏体素阻断连通。不存在或隐藏的种子返回空 Patch。
  - `paint-all` 把全部体素改成当前颜色并设为 `visible = true`；即使颜色相同，也要修正隐藏状态，合并为单个 `replaceAll` 或等价 Patch。
- Visibility：
  - `keys/color/all/slice-y` 只修改 `visible`，绝不删除体素；Slice Y 严格使用 `0 => all`、正数 `sliceY - 1`、负数 `sliceY` 的规则。
  - `isolate-color` 在同一 Patch 中把全部体素设隐藏、再把精确颜色组设可见；颜色比较使用规范化大写 `#RRGGBB`。
  - `InvertVisibilityCommand` 一次翻转全部体素的可见性；空模型返回空 Patch。
  - `DeleteHiddenCommand` 只删除隐藏键；空集合返回空 Patch，不写历史。
- `GroupByIslands`：
  - 先解除全部隐藏，再按 6 或 26 邻域计算连通分量；分量排序使用最小 `VoxelKey`，保证结果稳定。
  - 每个岛屿分配一个唯一颜色，排除 `#000000` 和 `#FFFFFF`；颜色由 `seed + 稳定岛屿序号` 确定性生成，碰撞时继续推进，避免测试和重做结果漂移。
  - 所有体素保留原位置并设为可见，颜色变更合成单个 Patch；超过 inline 阈值时通过 WorkerPort 处理纯快照，`operationId` 只用于进度/取消，Worker 原始消息不得直接提交。
- 失败与取消：`stale-version`、非法范围、非法方向、空结果和取消均不生成 Patch、不递增文档版本、不写 History；已开始的异步操作只能由 WorkerPort 取消，Handler 不得留下半提交状态。

**依赖**：voxel-commands、voxel-document、selection、symmetry、voxel-query、voxel-patch、model-operations、worker-port、util/color、util/packed-int、util/result。
