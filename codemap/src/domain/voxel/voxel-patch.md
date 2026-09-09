# voxel-patch.ts

**职责**：描述单个 `VoxObject` 局部网格上最小、可逆、可合并的体素变更。

**接口**：
- `PatchOp`：`add`、`remove`、`paint`、`setVisibility`、`relocate`、`replaceAll`。
- `VoxelPatch`：`ops`、`changedKeys`、`beforeBounds?`、`afterBounds?`、`isEmpty`。
- `add`、`remove`、`paint`、`setVisibility`、`relocate`、`replaceAll`、`invert`、`merge`、`bounds`。

**内部**：
- `VoxelPatch` 不包含 `objectId`；由 `ScenePatch.applyObjectVoxelPatch` 或命令上下文把它绑定到唯一活动对象。局部键只在目标对象内解释。
- 每个 Patch 只表达数据变化；不触发渲染、历史、UI、命令校验或 Worker。
- 同一提交内按稳定键归一化：Add 后 Remove 抵消，Paint/Visibility 保留最后一次值，Relocate 表示为源键 Remove + 目标键 Add，`replaceAll` 与其他操作互斥。
- Add 默认 `skip-existing`，显式 `overwrite` 时生成对应覆盖信息；Remove/Paint 对不存在的键是空操作。所有输出按 `VoxelKey` 排序，保证事务、历史和测试稳定。
- 冲突目标去重后只写一次；overwrite 数量由 Patch 元数据返回，不通过日志或全局状态传递。
- `invert` 必须能从正向 Patch 恢复精确颜色和可见性；`replaceAll` 的反向 Patch 保存完整旧快照。
- Patch 边界只根据变更键计算，不读取渲染状态；空 Patch 合法且不增加场景版本。
- 大批量算法结果先转换为目标对象的 `VoxelSnapshot`，再由 Handler 生成对象级 Patch，禁止把 Worker 消息直接提交给场景文档。
- 跨对象批量修改必须由多个对象级补丁或一个 `ScenePatch` 表达，不能把所有对象的局部键混入同一个 `VoxelPatch`。

**依赖**：voxel-types、util/color、util/packed-int。
