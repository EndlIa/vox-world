# animation-controller.ts

**职责**：实现 `application/ports/animation-port` 的 `AnimationSessionPort`（包括 `AnimationPreviewPort`），协调统一 `AnimationDocument`、运行时播放时钟、Camera Control、相机路径、Follow/Observe 预览和编辑器状态恢复。每帧只调用一次领域求值，并把同一个完整 `AnimationEvaluation` 交给注入的 `AnimationApplyPort`；控制器不实现插值、离线编码，也不绕过应用端口直接写 `scene` 或相机变换。

**接口**：实现 `AnimationSessionPort`，方法名和返回身份必须与端口完全一致。
- 数据与编辑：`load(document)`、`getSnapshot()`、`serialize()`、`hasTracksForNode(nodeId)`、`setDuration(durationMs)`、`setLoop(enabled)`、`createTrack(target, channel, timeMs, value, easing): Result<string, AnimationError>`、`deleteTrack(trackId)`、`addKeyframe(trackId, timeMs, value, easing): Result<string, AnimationError>`、`replaceKeyframe(trackId, keyframeId, timeMs, value, easing)`、`removeKeyframe(trackId, keyframeId)`、`moveKeyframe(trackId, keyframeId, timeMs)`。
- 选择与读取：`selectTrack(trackId | null)`、`selectKeyframe(trackId, keyframeId | null)`、`getPlaybackState()`。后者返回端口定义的只读 `{ status, currentTimeMs, hasOverride, followCamera, selectedTrackId, selectedKeyframeId }`，不返回动画文档。
- 播放与清理：`play()`、`pause()`、`stop()`、`seek(timeMs)`、`tick(nowMs)`、`stopAndClearOverride()`；`tick()` 是 `EditorSession.tick()` 唯一可调用的播放推进入口，`stop()` 是 UI 停止入口并委托 `stopAndClearOverride()`，避免两种停止路径产生不同 override 状态。
- 模式：`setFollowCamera(enabled)`、`setPathVisible(trackId, enabled)`。
- Camera Control：`addCameraKeyframeFromControl()`、`cameraToView()`、`viewToCamera()`、`setControlTransform(field, value)`、`setControlSelected(selected)`。
- 离线协作：`prepareOfflineCapture()` 返回幂等 `restore(): void`。
- 事件：实现端口 `subscribe(listener)`，只发出文档版本、播放状态、当前时间、选择状态、Camera Control/路径运行时摘要和错误摘要等纯数据；选择、Follow、路径或 Camera Control 状态变化也必须发出只读状态更新。内部可以拆成文档变更与运行时状态通知，但不得暴露两套公开订阅契约。

**内部辅助（不属于端口）**：
- `preparePlayback()`、`endPlayback()` 是 Follow/Observe 与 cinematic camera 切换的内部适配方法，不得被 UI 当作独立播放契约；外部行为统一由端口方法定义。
- `evaluateForFrame()` 不保留；离线渲染器自行冻结文档并调用 `domain/animation.evaluateAnimation`，避免形成第二套求值入口。

**内部**：
- 持有一个不可变 `AnimationDocument`；duration、loop、track/keyframe 插入/替换/删除/移动全部委托 `domain/animation`。控制器只保存 `currentTimeMs`、`status = stopped|playing|paused`、`selectedTrackId`、`selectedKeyframeId`、`hasOverride` 和单调时钟起点，不得在 Three.js 层复制插值算法。
- `load(document)` 先读取 `SceneDocument.snapshot()`，针对同一时刻的只读 `SceneSnapshot` 严格校验；失败保持旧文档和全部运行时状态不变。成功后原子替换文档，复位为 stopped、`currentTimeMs = 0`、`hasOverride = false`、清空 track/keyframe selection，结束 Camera Control/Follow/Observe preview，并调用 `AnimationApplyPort.clearEvaluation()`。
- 动画数据编辑属于项目作用域变更：成功修改文档后通过 `subscribe()` 发布文档变更，由 ProjectService 增加 `projectVersion` 并驱动 dirty；不得修改 `SceneDocument.version`。播放、seek、Follow/Observe、路径可见性、Camera Control 姿态/可见性/选择、`cameraToView`/`viewToCamera` 和 override 变化只属于运行时，不修改项目数据、`SceneDocument.version` 或 dirty 状态；只有 `addCameraKeyframeFromControl()` 实际写入动画文档时才触发 dirty。
- `setDuration()`、`setLoop()`、`createTrack()`、`deleteTrack()`、`addKeyframe()`、`replaceKeyframe()`、`removeKeyframe()`、`moveKeyframe()` 和 `addCameraKeyframeFromControl()` 统一执行端口门禁：`status !== 'stopped'` 或 `hasOverride` 时返回 `animation-playback-active`，不得产生部分文档变更。调用方必须先执行 `stopAndClearOverride()`；控制器不得自动停播或建立平行门禁。
- `createTrack()` 只接受合法 target/channel 并返回新稳定 `trackId`；Node target 必须存在且不能是根节点。`addKeyframe()` 返回新稳定 `keyframeId`。`deleteTrack()`、关键帧替换/删除/移动和非法 target 均返回明确 `Result`。
- `selectTrack(trackId | null)` 只接受现有轨道或 `null`，选择轨道时清空不兼容的 `selectedKeyframeId`；`selectKeyframe(trackId, keyframeId | null)` 要求轨道存在，非空关键帧必须属于该轨道。删除选中关键帧时清空 `selectedKeyframeId`；删除选中轨道，或删除最后一个关键帧导致轨道消失时，再同步清空 `selectedTrackId`。选择是运行时状态，不写项目、History 或 `SceneDocument`。
- `getPlaybackState()` 是命令门禁和应用层读取状态的唯一来源；`hasOverride` 仅在最近一次 `applyEvaluation()` 含至少一个 Node/Camera override 时为 `true`，在空 evaluation、`clearEvaluation()`、`stopAndClearOverride()`、`load()`、项目切换和 context restore 后为 `false`。应用层不得仅依赖 UI 事件判断是否可编辑。
- `play()` 在空文档时拒绝启动并保持 stopped；位于末尾时从 `0` 重新开始。`pause()` 固化当前时间并保留 override；`stop()`/`stopAndClearOverride()` 回到 stopped 并清除全部运行时 override。`tick(nowMs)` 是唯一播放推进入口，循环时 `currentTimeMs = elapsed % durationMs`；非循环到达末尾后走同一停止清理事务。`EditorSession.tick()` 只委托此方法，不得在应用层再次调用 `evaluateAnimation` 或 `applyEvaluation`。
- 每次播放推进或 seek 只调用一次 `evaluateAnimation(document, currentTimeMs)`，随后只调用一次 `AnimationApplyPort.applyEvaluation(evaluation)`。Node 与 Camera 覆盖必须来自同一次完整 evaluation；控制器不得直接调用 `scene.setNodeAnimationOverride()`、`camera-controller.applyAnimationOverride()` 或分别应用 Node/Camera。
- Node 轨道表达相对父节点的局部变换；父子轨道同时播放时由 `AnimationApplyPort` 实现中的场景图矩阵组合自然得到世界变换。控制器不得预先把 Node 轨道烘焙成世界矩阵。
- Camera 轨道通过同一个 `AnimationEvaluation.camera` 驱动 cinematic/编辑器相机。文档没有 Camera 轨道时，Node 动画仍在编辑器相机下播放，不切换相机、不改变导航控制；有 Camera 轨道时 Follow 默认开启。
- `Follow Camera` 播放开始时保存编辑器 view、投影、controls 启用状态、Camera Control 作者姿态/可见性/选择状态和 path 可见性；隐藏并取消选择 Camera Control，将活动相机切到 cinematic camera。暂停时把当前 cinematic view 转回编辑器相机并重新附加 controls，但不修改动画数据；停止或非循环结束后恢复播放前编辑器状态。
- Follow 关闭时进入 Observe Mode：编辑器相机保持活动、可交互，Camera Control 临时显示由 authored/base camera 与本次 `AnimationEvaluation.camera` patch 合并后的完整 effective camera pose。结束、取消或 context lost 时恢复作者 Camera Control 状态；临时播放姿态不得进入 track、keyframe 或项目 JSON。
- `Camera -> View`、`View -> Camera`、`Add Keyframe` 和 `setControlTransform` 只在 camera target 可用；Node target 不得借用 Camera Control。`addCameraKeyframeFromControl()` 在 `currentTimeMs` 原子插入/替换 camera position、rotation、fov 三条轨道的关键帧，缺失轨道先创建；无 control 时返回不可用，不得留下部分轨道或关键帧。
- 路径只由 camera position track 采样生成白色 Line；采样点数量取 `min(128, (keyframeCount - 1) * 16 + 1)`，只在至少两个关键帧时显示。关键帧 marker 使用空心 billboard 圆。路径/marker 使用渲染辅助层，不进入体素拾取；截图和离线渲染期间必须隐藏并在 `finally` 恢复原开关。
- `prepareOfflineCapture()` 先调用 `stopAndClearOverride()`，通过 `AnimationApplyPort.clearEvaluation()` 清除全部 Node/Camera override并恢复 authored/base view；随后保存编辑器状态、隐藏 Camera Control/路径/marker、切换到 cinematic camera。返回的 restore 必须幂等，在成功、取消、异常和 context lost 后都恢复播放前编辑器 view/投影、controls、Camera Control 作者姿态/可见性/选择、路径开关和后处理绑定；不得自动重新播放，也不得把 cinematic/Node 临时姿态写回作者数据。
- `stopAndClearOverride()`、非循环自然结束、用户取消、进入 Object/Voxel XFORM、切换 Edit 模式和 context lost 走同一个恢复事务：先通过 `AnimationApplyPort.clearEvaluation()` 清除 Node/Camera override与 Follow/Observe 临时显示，再恢复编辑器相机、controls、Camera Control 与 path 状态；恢复函数只执行一次。
- 项目新建时调用 `load(createDefaultAnimation())`；加载或 Storage/snapshot 恢复时只接受 `domain/animation` 针对当前 SceneSnapshot 严格校验通过的 V1 文档，缺字段、非法轨道、根节点 target 或悬空 Node target 由项目加载整体失败。Camera Control 不属于项目格式，加载后必须清空。
- `hasTracksForNode(nodeId)` 供应用层删除预检；V1 不自动删除被引用节点的轨道，存在引用时删除命令必须失败。

**依赖**：application/ports/animation-port、domain/animation、domain/scene/scene-types、state/scene-document、camera-controller、camera-control、overlays、util/math、util/result。
