# animation-port.ts

**职责**：定义应用层对统一动画文档、播放会话、离线预览和运行时求值应用的抽象；本文件是这些端口类型的唯一归属。
**接口**：
- `AnimationPreviewPort`：`prepareOfflineCapture()` 返回幂等 `{ restore(): void }`；这是离线渲染服务需要的最小预览控制面。
- `AnimationSessionPort extends AnimationPreviewPort`：`load(document)`、`getSnapshot()`、`serialize()`、`hasTracksForNode(nodeId)`、`setDuration(durationMs)`、`setLoop(enabled)`、`createTrack(target, channel, timeMs, value, easing): Result<string, AnimationError>`、`deleteTrack(trackId)`、`addKeyframe(trackId, timeMs, value, easing): Result<string, AnimationError>`、`replaceKeyframe(trackId, keyframeId, timeMs, value, easing)`、`removeKeyframe(trackId, keyframeId)`、`moveKeyframe(trackId, keyframeId, timeMs)`、`selectTrack(trackId | null)`、`selectKeyframe(trackId, keyframeId | null)`、`getPlaybackState()`、`play()`、`pause()`、`stop()`、`seek(timeMs)`、`tick(nowMs)`、`setFollowCamera(enabled)`、`setPathVisible(trackId, enabled)`、`stopAndClearOverride()`、`addCameraKeyframeFromControl()`、`cameraToView()`、`viewToCamera()`、`setControlTransform(field, value)`、`setControlSelected(selected)`、`subscribe(listener)`。
- `AnimationApplyPort`：`applyEvaluation(evaluation)`、`clearEvaluation()`。
- `AnimationOutputWriter`：`addFrame(blob, metadata): Promise<void>`、`finalize({ cancelled }): Promise<AnimationOutputResult>`、`abort(reason?): Promise<void>`。`AnimationOutputMetadata` 至少含 `{ frame; totalFrames }`；文件名、编码时间戳等格式细节由 writer 根据创建时的 settings 自行推导。`AnimationOutputResult` 至少含 `{ cancelled; completed; totalFrames }`。writer 是输出句柄、文件命名、格式时间戳和最终提交/回滚的唯一所有者。
- `getPlaybackState()` 返回只读运行时状态：`{ status: 'stopped' | 'playing' | 'paused'; currentTimeMs: number; hasOverride: boolean; followCamera: boolean; selectedTrackId: string | null; selectedKeyframeId: string | null }`。它不返回 `AnimationDocumentV1`，也不暴露时钟句柄或可变 override 容器。
- `subscribe(listener)` 发出文档版本、播放状态、当前时间、选中轨道/关键帧、Camera Control/路径运行时摘要和错误摘要的只读数据，返回幂等 `Unsubscribe`；选择、Follow、路径或 Camera Control 状态变化也必须触发事件。

**内部**：
- `AnimationSessionPort` 只暴露用例所需的纯数据和幂等操作，不暴露 Three.js 对象、播放时钟句柄、可变 `AnimationDocument` 或运行时 override 容器。
- `getSnapshot()` 返回 `AnimationDocumentV1` 的只读深快照；轨道和关键帧编辑返回明确 `Result`，失败不得产生部分文档变更。`createTrack()` 成功值是新分配的稳定 `trackId`；`addKeyframe()` 成功值是新分配的稳定 `keyframeId`，调用方不得猜测或用数组索引代替。
- `load(document)` 必须先针对当前 `SceneSnapshot` 严格校验输入；失败保持旧文档、播放状态、override 和选择状态不变。成功后原子替换文档并复位为 `status = stopped`、`currentTimeMs = 0`、`hasOverride = false`、`selectedTrackId = null`、`selectedKeyframeId = null`，同时结束 Camera Control/Follow/Observe preview 并调用 `AnimationApplyPort.clearEvaluation()`。
- 轨道和关键帧编辑必须委托 `domain/animation` 校验；Node target 必须存在且不能是根节点，非法 target 返回明确失败且不得改变文档或播放状态。`play()` 在空文档或无可播放轨道时不得启动，状态保持 `stopped`。
- `setDuration()`、`setLoop()`、`createTrack()`、`deleteTrack()`、`addKeyframe()`、`replaceKeyframe()`、`removeKeyframe()`、`moveKeyframe()` 和 `addCameraKeyframeFromControl()` 必须由端口实现统一执行编辑门禁：`status !== 'stopped'` 或 `hasOverride === true` 时返回 `animation-playback-active`，且不得产生部分文档变更。调用方先执行 `stopAndClearOverride()`；application 层不得另建平行门禁，也不得假设端口会自动停播。
- `selectTrack(trackId | null)` 只接受现有 `trackId` 或 `null`；选择轨道时清空不兼容的 `selectedKeyframeId`。`selectKeyframe(trackId, keyframeId | null)` 要求 track 存在，`keyframeId = null` 表示只选轨道，非空时必须是该轨道的关键帧。选择是运行时 UI 状态，不写项目、History 或 `SceneDocument`，非法选择不得产生部分变更。
- `deleteTrack()` 删除当前选中轨道时必须同步清空 `selectedTrackId`/`selectedKeyframeId`；`removeKeyframe()` 删除当前选中关键帧时清空 `selectedKeyframeId`，若它是最后一个关键帧而隐式删除轨道，再一并清空 `selectedTrackId`。删除未选轨道/关键帧不得改变选择。
- `addCameraKeyframeFromControl()` 只读取当前 Camera Control；不存在时返回不可用且不改文档。成功时在 `currentTimeMs` 原子插入/替换 camera `position`、`rotation`、`fov` 三条轨道的关键帧，缺失轨道先创建，整个操作作为一次项目文档变更发布，不得产生部分 camera 轨道。
- `getPlaybackState()` 是命令门禁和应用层读取播放/override 状态的唯一契约；`hasOverride` 仅在最近一次 `applyEvaluation()` 含至少一个 Node/Camera override 时为 `true`，在空 evaluation、`clearEvaluation()`、`stopAndClearOverride()`、项目加载/切换和 context restore 后为 `false`。不得通过 UI 事件推断门禁状态。
- `tick(nowMs)` 是播放推进的唯一公共入口，由 `EditorSession.tick()` 委托调用；`status = playing` 时最多执行一次 `evaluateAnimation` 和一次 `applyEvaluation`，`stopped`/`paused` 时无副作用。EditorSession 不得自行求值、应用 override 或复制播放时钟。
- `hasTracksForNode(nodeId)` 是节点删除和场景 undo/redo 的引用预检入口；只读，不修改文档或播放状态。
- `stopAndClearOverride()` 必须幂等：停止播放时钟，并调用 `AnimationApplyPort.clearEvaluation()` 清除全部 SceneNode 与相机 override，恢复 authored/base 状态；不得写项目、`SceneDocument`、`SceneDocument.version`、项目 dirty 版本或 History。
- `prepareOfflineCapture()` 返回幂等 `{ restore(): void }`；进入时停止交互预览，先清除全部运行时 override 并恢复 authored/base 相机，再保存编辑器状态、隐藏 Camera Control/路径/keyframe marker并建立稳定的活动相机，但不修改动画文档。`restore()` 负责恢复保存的作者视图和编辑器状态，调用后播放仍保持 stopped。
- `AnimationApplyPort.applyEvaluation(evaluation)` 原子替换完整运行时求值结果；未出现在本次 evaluation 中的节点或相机覆盖必须清除。`clearEvaluation()` 幂等恢复 authored/base 场景与相机。
- `AnimationOutputWriter` 是应用层公开的输出契约，唯一 owner 是本文件；service 通过 `AnimationOutputPort` 创建它，`animation-renderer` 只消费传入实例并调用 `addFrame`、`finalize`、`abort`，不得声明同形 DTO 或自行选择输出。
- 播放和离线渲染的每一帧必须只调用一次 `domain/animation.evaluateAnimation`，再把同一个 `AnimationEvaluation` 交给 `AnimationApplyPort.applyEvaluation()`；禁止分别求值 Node/Camera 或跨帧拼接覆盖。
- 端口不解释插值、target/channel 合法性或场景层级；这些规则由 `domain/animation` 和场景快照校验负责，实现方不得绕过。

**依赖**：domain/animation、domain/scene/scene-types、util/result。
