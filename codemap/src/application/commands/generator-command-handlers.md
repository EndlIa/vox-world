# generator-command-handlers.ts

**职责**：校验生成命令、执行确定性生成，并生成 NEW SCENE Patch 或启动 XFORM 新源会话。

**接口**：
- `GenerateVoxelsHandler.canHandle(command)`、`validate(command, context)`、`execute(command, context) -> CommandOutcome`。
- `estimateGeneration(command)` 返回体素数上界；`runGeneration(command, context, signal) -> Result<VoxelSnapshot>`。
- `CommandOutcome` 可包含 `patch?`、`stateEffects?`、`followUps?`、`operationId?`、`notification?`；生成器不得直接修改状态。

**内部**：
- 执行前先做活动 XFORM 门禁：若 session 存在，由 EditorSession 先 Apply；Apply 失败或用户取消时不得派发生成命令。随后校验 `baseVersion`、spec 范围和体素数量上限。
- 小结果可在 Handler 内同步调用 `generate`；估算体素数超过 `inlineGenerationLimit` 时必须通过 `WorkerPort.run` 执行。Worker 输入只有纯 `GeneratorSpec`/seed/options，输出只有 `VoxelSnapshot`；进度以 `operationId` 发布，取消通过 `ToolContext.cancelOperation` 转发到 WorkerPort。
- `placement = "new-scene"`：成功后返回一个 `replaceAll` Patch，目标快照完全来自生成结果，颜色/可见性按 spec 设置；文档版本不匹配返回 `stale-version`，Worker 失败/取消返回错误且不写 History。
- `placement = "xform-new"`：不返回体素 Patch，而是返回 `BeginTransformCommand { sourceKind: "new", placement: "xform-new", source: snapshot entries, baseVersion }` 的 follow-up 状态效果。该会话 Apply 时才写入模型，Cancel 时丢弃，不得在生成阶段偷偷修改文档。
- NEW SCENE 替换后清除旧 Selection、TransformSession、working pick 和预览；渲染同步只能消费最终 Patch/Snapshot，不读取 Worker 原始消息。
- Plane 使用 `height = 1` 的 Box spec；Add Wall、Bridge、Box/Rect 编辑仍由 voxel command handlers 负责，不复用生成器命令。
- 空结果、非法尺寸、颜色无效、Worker 异常和取消都返回显式 Result；失败/取消保持文档、Selection、History 和相机动画状态不变。

**依赖**：generator-commands、generator、voxel-document、voxel-patch、worker-port、transform-command、util/result。
