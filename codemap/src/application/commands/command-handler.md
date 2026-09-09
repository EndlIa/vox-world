# command-handler.ts

**职责**：解释一种 Command 并执行对应领域规则。
**接口**：canHandle(command)、validate(command, context)、execute(command, context) → CommandOutcome。
**内部**：context 只暴露显式注入的只读状态和纯能力，包括 `SceneDocument` 只读快照、EditorState、Object/Voxel Selection 和活动对象视图；Handler 负责语义校验并返回 `ScenePatch`、状态效果和错误；反向补丁由 Transaction 生成；不直接修改状态、渲染器或历史。
- Handler 不得从全局 `VoxelKey` 推断对象身份；所有体素操作必须通过 `objectId` + 局部视图进入。
- Edit 模式命令必须验证活动对象；Object 模式命令必须拒绝体素键和对象内部数据。

**依赖**：command、scene-document、scene-patch、editor-state、object-selection、voxel-selection、util/result。
