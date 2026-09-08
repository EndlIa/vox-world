# transform-command-handler.ts

**职责**：解释选择与 XFORM 命令，校验 working 坐标，并在 Apply/Delete 时生成可逆补丁。

**接口**：
- `handleSelection(command, context) -> CommandOutcome`：解析五类选择策略，返回 Selection 状态变更描述或错误；不生成体素 Patch。
- `handleTransform(command, context) -> CommandOutcome`：返回 TransformSession 状态变更描述、通知和/或在提交时生成的 `VoxelPatch`。
- `resolveWorkingPick(token, context) -> TransformEntry`：把独立 working-pick pass 的结果映射回 session entry；仅允许通过 `TransformSession.candidatePosition` 解析实际位置。
- `handleTransform(command, context)` 的预览/选择/取消路径不写 History；只有 Apply、Delete Selected 和显式 Commit 路径可以返回 Patch。

**内部**：
- 五类选择：Box 使用闭区间内体素；Rectangle 使用屏幕投影候选，`bypass = false` 时与 surfaceKeys 求交；Color 使用规范化颜色精确相等；Island 从种子执行 6/26 连通遍历；Visible 返回全部 `visible === true` 的体素。所有策略返回去重、稳定排序的键。
- Color 选择只按颜色相等取键，因此同一颜色跨多个岛屿也作为同一颜色组；随后 `builder` XFORM 变换原体素，`clone` XFORM 保留原体素并复制，不需要颜色组持久化 ID。
- XFORM 活动时，Box/Rect/Color/Island/Visible 的所有候选必须先通过 `candidatePosition(entry)` 映射；working-pick pass 只负责返回 entry/token，不能以 `workingPosition` 直接参与选择。rootDelta 在 Add/Subtract、Island 扩散、镜像、旋转和提交前先 flush。
- Begin：
  - `builder` 保存 sourceKey 到 entry 的唯一映射，重复 source 不重复加入。
  - `clone` 保留源体素，允许在源和 working entry 两侧继续 Add；按 `(sourceKind, candidatePosition)` 去重，隐藏的 moved source 不作为拾取候选。
  - `new` 不建立 source 关联，selectionMode 固定为 add，不能 Subtract；Apply 只写目标，Cancel 丢弃。
  - 会话开始时冻结 `baseVersion`；任何提交前都必须与当前文档版本相等，否则返回 `stale-version` 并保留 session/预览。
- Move：只更新 `rootDelta`，不生成 Patch；`candidatePosition(entry) = workingPosition + rootDelta`。位置必须保持安全整数；非法 delta 返回错误并保留原预览。
- Mirror：先 flush rootDelta，按 axis/pivotMode 计算 pivot，再对每个 entry 的 workingPosition 执行 `round(2 * pivot - position)`；结果按候选位置去重，只返回 session 状态变更，不产生 VoxelPatch。
- Rotate/Scale：按 axis、direction 和 pivotMode 计算 workingPosition。Bounds pivot 为 entry 包围盒中心，World pivot 固定为 `(-0.5, -0.5, -0.5)`；变换后坐标必须落到整数网格，冲突按候选去重。
- Clone/Duplicate：`sourceKind = clone`，源体素保留；Duplicate 可用初始 offset 表达一次复制，但偏移仍通过 rootDelta/workingPosition 路径校验，不直接写文档。
- Apply/Commit：
  - 先 flush rootDelta，再冻结 entry 子集；对 `builder` 生成“移除源键 + 写入目标键”的 Patch，对 `clone` 只写目标，对 `new` 不删源。
  - 目标键先按 `VoxelKey` 去重；与 session 外体素冲突时采用目标覆盖，返回 `overwritten` 数量供一次通知。不得产生重复键或部分提交。
  - Patch 必须能完整反转颜色和可见性；成功后由 EditorSession 结束 session、清 working pick 映射和预览。失败或取消不得写 History、不得部分修改文档。
- Cancel：丢弃 entry、source 映射、rootDelta、working pick 映射和预览，不生成 Patch、不写 History。
- Delete Selected：builder 删除全部 source 体素并结束；clone/new 只删除尚未提交的 entry，不删除原模型。空选择返回空结果。
- NEW SCENE：`placement = "new-scene"` 时只能以 `sourceKind = "new"` 开始；Apply 用生成/复制数据覆盖或替换当前模型，Cancel 保持原模型不变。该语义由命令显式携带，不能依赖 UI 复选框的当前值。
- 失败与取消：版本冲突、非法矩阵/范围、Worker 失败、取消或空 Patch 都保持 session 与文档原状；只有成功事务才更新 Selection、History 和 RenderSync。

**依赖**：transform-command、transform-session、selection、selection-strategies、symmetry、voxel-document、voxel-patch、util/math、util/result。
