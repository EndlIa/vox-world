# patch.ts

**职责**：描述单个 `SceneObject` 局部网格上最小、可逆、可合并的体素变更，并定义这些变更的纯应用语义。

**接口**：
- `PatchOp`：`add`、`remove`、`paint`、`relocate`、`replaceAll`；`setVisibility`【暂不实现】。
- `VoxelPatch`：`ops`、`changedKeys`、`beforeBounds?`、`afterBounds?`、`isEmpty`。
- `add`、`remove`、`paint`、`relocate`、`replaceAll`、`invert`、`merge`、`bounds`；`setVisibility`【暂不实现】。
- `apply(snapshot: UniformVoxSnapshot, patch: VoxelPatch): Result<UniformVoxSnapshot, PatchApplyError>`：体素变更的纯应用入口。
- `PatchApplyError`：普通可序列化错误数据（`UniformVoxSnapshotError` 与补丁不自洽错误的并集，含稳定 `code`），可跨 Worker/持久化边界。

**内部**：
- `VoxelPatch` 不包含 `sceneObjectId`；由 `ScenePatch.applySceneObjectVoxelPatch` 或命令上下文把它绑定到唯一活动对象。局部键只在目标对象内解释。
- 每个 Patch 只表达数据变化；不触发渲染、历史、UI、命令校验或 Worker。
- 归一化是 patch 自身的纯变换，在构造期完成，不依赖文档状态或版本；同一提交内按稳定键归一化：Add 后 Remove 抵消，Paint 保留最后一次值（Visibility【暂不实现】），Relocate 表示为源键 Remove + 目标键 Add，`replaceAll` 与其他操作互斥。
- Add 默认 `skip-existing`，显式 `overwrite` 时生成对应覆盖信息；Remove/Paint 对不存在的键是空操作。所有输出按 `VoxelKey` 排序，保证事务、历史和测试稳定。
- 冲突目标去重后只写一次；overwrite 数量由 Patch 元数据返回，不通过日志或全局状态传递。
- 【用户确认 2026-09-13】体素变更语义归属：增删改查全部由本模块定义，`apply` 是唯一真相，`patch.ts` 属纯数据层。当时否决的取舍：把 patch 与 Document 同阶段实现、由状态层 `SceneDocument.applyPatch` 内嵌并解释 op 语义。
- `apply` 是纯函数：不修改输入 `snapshot` 与 `patch`，返回 canonical 新容器（排序、去重与 palette 规范化复用 `uniformVoxSnapshot`），实现为“物化记录 → 应用 op → 重新构造容器”；不读取文档、Selection、History、渲染或 Worker 状态。
- `apply` 与 `invert` 互为对偶：`apply(apply(snapshot, patch), invert(patch))` 必须恢复等价（不必同一引用）快照；`isEmpty` 的 patch 的 `apply` 返回与输入等价的快照。
- `apply` 的失败全部显式返回，不抛业务异常；`PatchApplyError` 覆盖两类来源：容器构造失败（`uniformVoxSnapshot` 的 `UniformVoxSnapshotError`，如 `palette-limit-exceeded`）与补丁自身违反本节不变量（`{ code: "invalid-patch", details }`，如 `replaceAll` 与其他 op 混用）。`remove`/`paint` 对不存在的键是空操作，不是错误。
- 状态层不得重新解释 op 语义：`SceneDocument.applyPatch` 只做版本校验、原子替换与订阅通知，对象内体素变化必须经 `apply` 产生；提交后的 `sceneObjectSnapshot(sceneObjectId)` 必须与 `apply(提交前快照, patch)` 等价。
- `invert` 必须能从正向 Patch 恢复精确颜色（可见性【暂不实现】）；`replaceAll` 的反向 Patch 保存完整旧快照（快照中的可见性随 `types` 的【暂不实现】一并挂起）。
- Patch 边界只根据变更键计算，不读取渲染状态；空 Patch 合法且不增加场景版本。
- 大批量算法结果先转换为目标对象的 `UniformVoxSnapshot`，再由 Handler 生成对象级 Patch，禁止把 Worker 消息直接提交给场景文档。
- 跨对象批量修改必须由多个对象级补丁或一个 `ScenePatch` 表达，不能把所有对象的局部键混入同一个 `VoxelPatch`。

**依赖**：types、util/color、util/packed-int、util/result。
