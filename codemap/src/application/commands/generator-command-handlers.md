# generator-command-handlers.ts

**职责**：校验生成命令、执行确定性生成，并创建新 `VoxObject` 或启动活动对象的 Voxel XFORM 新源会话。

**接口**：
- `GenerateVoxelsHandler.canHandle(command)`、`validate(command, context)`、`execute(command, context) -> CommandOutcome`。
- `estimateGeneration(command)` 返回体素数上界；`runGeneration(command, context, signal) -> Result<VoxelSnapshot>`。
- `CommandOutcome` 可包含 `patch?`、`stateEffects?`、`followUps?`、`operationId?`、`notification?`；生成器不得直接修改状态。

- 执行前先做活动 XFORM 门禁：若 session 存在，由 EditorSession 先处理；失败或用户取消时不得派发生成命令。随后校验模式、`baseSceneVersion`、spec 范围和体素数量上限。若命令将进入 `active-object-xform`，成功生成后、启动 VoxelTransformSession 前由 EditorSession 停止动画并清除全部 Node/Camera 运行时 override。
- 小结果可在 Handler 内同步调用 `generate`；估算体素数超过 `inlineGenerationLimit` 时必须通过 `WorkerPort.run` 执行。Worker 输入只有纯 `GeneratorSpec`/seed/options，输出只有 `VoxelSnapshot`；进度以 `operationId` 发布，取消通过 `ToolContext.cancelOperation` 转发到 WorkerPort。
- `placement = "new-object"`：Object 模式下成功后返回一个含 `addNode` + `attachObject` 的 `ScenePatch`；新对象的局部快照完全来自生成结果，颜色/可见性按 spec 设置，节点使用命令给定的名称和变换。场景版本不匹配返回 `stale-version`。
- `placement = "active-object-xform"`：Edit 模式下不返回体素 Patch，而是返回 `BeginTransformCommand { objectId: activeObjectId, sourceKind: "new", source: snapshot entries, baseSceneVersion }` 的 follow-up 状态效果。生成成功后才执行 `stopPlaybackAndClearOverride()`，再启动会话；播放/override 清理失败时不得返回 follow-up。该会话 Apply 时才写入活动对象，Cancel 时丢弃。
- 生成结果只使用目标对象的局部坐标；不得把多个对象压平到全局快照。创建新对象后清除旧 ObjectSelection，但不改变其他对象或活动编辑状态。
- Plane 使用 `height = 1` 的 Box spec；Add Wall、Bridge、Box/Rect 编辑仍由 voxel command handlers 负责，不复用生成器命令。
- 空结果、非法尺寸、颜色无效、Worker 异常和取消都返回显式 Result；生成失败/取消不修改动画文档，也不进入 XFORM，因此不改变播放状态或 override。成功进入 `active-object-xform` 后，播放状态按上述门禁归零且不得被恢复。

**依赖**：generator-commands、generator、scene-types、scene-patch、scene-document、editor-state、object-selection、voxel-transform-command、worker-port、util/result。
