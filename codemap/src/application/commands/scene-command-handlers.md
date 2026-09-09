# scene-command-handlers.ts

**职责**：解释 SceneCommand，校验 Object/Edit 模式与场景身份，并生成场景补丁或状态效果。

**接口**：
- `SceneCommandHandler.canHandle(command)`、`validate(command, context)`、`execute(command, context) -> CommandOutcome`。
- `CommandOutcome` 可包含 `patch?: ScenePatch`、`stateEffects?`、`notification?`、`error?`。

**内部**：
- 通用校验：命令类型对应的模式、`baseSceneVersion`、节点/对象存在性、父子关系、变换有效性和对象唯一绑定。Context 额外暴露 `AnimationSessionPort.hasTracksForNode()` 和 `AnimationSessionPort.getPlaybackState()`；Handler 不持有动画控制器。
- `select-object` 只写 ObjectSelection；对象必须存在。屏幕拾取来源必须是稳定 `VoxObjectId`，outliner 选择隐藏对象时必须显式标记来源。
- `create-vox-object` 分配稳定新 ID、校验局部快照和节点变换，并要求父节点是组节点；返回一个含 `addNode` + `attachObject` 的 ScenePatch；不得覆盖现有对象。
- `delete-vox-object` 只在 Object 模式可用。EditorSession 已先停止播放并清除 override；Handler 在生成任何 Patch 前查询绑定节点是否被任一 animation track 引用。若被引用，返回 `node-referenced-by-animation`、待删除 `nodeId` 和全部相关 `trackId`，不修改 SceneDocument、Selection、History 或动画文档。检查通过后才返回删除节点和对象的原子 ScenePatch；若删除当前 ObjectSelection，同一状态效果清空选择。Edit 模式删除体素应走 Voxel 命令，不得把对象删除伪装成体素删除。
- `set-object-visibility` 只修改绑定节点；`rename-scene-node` 不改变身份；`reparent-scene-node` 必须拒绝根节点、自环、后代环和把对象叶节点变成带子节点的非法结构。需要保持世界姿态时用 `scene-query.worldTransform` 先计算旧世界变换，再求相对新父节点的局部变换。
- Object Transform 命令：Begin 要求播放状态为 stopped 且全部 Node/Camera override 已清除，随后捕获版本和作者态原变换；Update 只更新 working preview；Apply 在版本一致时返回 `setNodeTransform` Patch；Cancel 丢弃预览。任何路径都不修改对象体素或动画文档。
- `enter-edit-mode` 校验对象存在、有效可见、场景版本、没有未处理的 Object XFORM，并要求播放状态为 stopped 且全部 Node/Camera override 已清除；随后原子写入 ObjectSelection 与 EditorState，并清空旧体素 Selection。不可见时返回 `object-not-visible`，不隐式修改节点可见性。`set-active-object` 只允许在 Edit 模式内切换到另一个有效可见对象，同样原子更新两者并清理旧 Selection/XFORM；`exit-edit-mode` 必须由 EditorSession 先处理活动 Voxel XFORM，只修改 EditorState。
- 若 Begin Object Transform 或 Enter Edit 到达 Handler 时仍报告 `playing`/`paused` 或活动 override，返回 `animation-playback-active`；不得在 Handler 内修改 SceneDocument 后再尝试停播。
- Handler 不直接修改 SceneDocument、EditorState、Selection、History、动画文档、播放状态、override 或渲染器；失败不产生 Patch/状态部分提交。

**依赖**：application/ports/animation-port、scene-commands、scene-types、scene-query、scene-patch、scene-document、editor-state、object-selection、object-transform-session、voxel-selection、util/result。
