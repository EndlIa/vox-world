# object-selection.ts

**职责**：持有当前场景中唯一选中的 `VoxObject` 身份；选择在 Object/Edit 模式之间保留。

**接口**：
- `ObjectSelectionSnapshot`：`{ selectedObjectId: VoxObjectId | null; version }`。
- `select`、`clear`、`contains`、`snapshot`、`subscribe`。

**内部**：
- 第一版一次只选择一个 `VoxObject`；多选和批量对象变换暂不定义。对象身份是稳定 `VoxObjectId`，不是节点实例、数组索引或体素键。
- 只有 Object 模式的选择命令可以改变本状态。Edit 模式下它必须与 `EditorState.activeObjectId` 相等；切换活动对象由同一个状态效果原子更新两者。
- 选择前必须由命令 Handler 验证对象存在于当前场景；隐藏对象可以通过 outliner 明确选择，但不能通过屏幕拾取命中。
- Object Selection 不读取或复制对象内部体素，不持有 `VoxelKey`，不生成 Patch、不写 History。
- 对象删除、场景替换或退出项目时必须清空；退出 Edit 模式不清空，从而保留返回 Object 模式后的选择。不把体素选择写入本状态。

**依赖**：scene-types、util/result。
