# camera-animation-controller.ts

**职责**：协调相机动画 clip、运行时播放时钟、Camera Control、相机路径、Follow/Observe 预览和编辑器相机恢复；它把纯领域动画连接到 `camera-controller`、`camera-control` 与渲染调度器，但不实现离线编码。

**接口**：
- 数据与编辑：`load(document)`、`serialize()`、`setDuration(ms)`、`insertKeyframe(state, timeMs, easing)`、`removeKeyframe(id)`、`moveKeyframe(id, timeMs)`、`getClip()`。
- 播放：`play()`、`pause()`、`stop()`、`seek(timeMs)`、`update(nowMs)`、`getPlaybackState()`。
- 模式：`setFollowCamera(enabled)`、`setPathVisible(enabled)`、`preparePlayback()`、`endPlayback()`。
- Camera Control：`addKeyframeFromControl()`、`cameraToView()`、`viewToCamera()`、`setControlTransform(field, value)`、`setControlSelected(selected)`。
- 离线协作：`prepareOfflineCapture()` 返回 `restore(): void`；`evaluateForFrame(frame, fps)` 只调用领域 evaluate。
- 事件：`onChange(reason)`、`onPlaybackStateChange(state)`，只发出纯数据和状态摘要。

**内部**：
- 组合一个 `CameraAnimationClip`；duration、keyframe 插入/替换/删除/移动全部委托 `domain/animation`，控制器只保存 `currentTimeMs`、`status = stopped|playing|paused` 和单调时钟起点。不得在 Three.js 层复制插值算法。
- `play()` 在 clip 非空时启动；位于末尾时从 `0` 重新开始。`pause()` 固化当前时间，`stop()` 回到 stopped 但保留作者数据和当前时间，`update(nowMs)` 只由统一帧循环调用。循环时 `currentTimeMs = elapsed % durationMs`；非循环到达末尾后停止并触发恢复。
- `status = stopped|playing|paused` 和 `currentTimeMs` 只存在于运行时，绝不写入项目 JSON、Storage snapshot 或 `domain/animation` clip；加载、项目切换和恢复默认从 `stopped`、`0ms` 开始，不自动续播。
- `Follow Camera` 默认开启。Follow 播放开始时保存编辑器 view、投影、controls 启用状态、Camera Control 的作者姿态/可见性/选择状态和 path 可见性；隐藏并取消选择 Camera Control，将活动相机切到 cinematic camera。每帧先 evaluate/apply，再渲染。暂停时把当前 cinematic view 转回编辑器相机并重新附加 controls，但不修改动画数据；停止或非循环结束后恢复播放前的编辑器状态。
- Follow 关闭时进入 Observe Mode：编辑器相机保持活动、可交互，Camera Control 临时显示 evaluated state。结束、取消或上下文丢失时恢复作者 Camera Control 状态；临时播放姿态不得进入 keyframe 或项目 JSON。
- `Camera -> View` 捕获当前编辑器 view 并写入 Camera Control，必要时创建 control；`View -> Camera` 把 Camera Control 的现有姿态应用到编辑器相机。`Add Keyframe` 仅从 Camera Control 读取；无 control 时返回不可用。三种操作都不得复用 OrbitControls 的 target/alpha/beta/radius 作为项目数据。
- 路径由当前 clip 采样生成白色 Line；采样点数量取 `min(128, (keyframeCount - 1) * 16 + 1)`，只在至少两个关键帧时显示。关键帧 marker 使用空心 billboard 圆，位置取关键帧 position。路径/marker 使用渲染辅助层，不进入体素拾取；截图和离线渲染期间必须隐藏并在 `finally` 恢复原开关。
- `prepareOfflineCapture()` 先停止播放并结束 preview，再隐藏 Camera Control、路径和 marker，切换到 cinematic camera。返回的 restore 必须幂等，在成功、取消、异常和 context lost 后都恢复播放前编辑器 view/投影、输入 controls 启用状态、Camera Control 作者姿态/可见性/选择、路径开关和后处理绑定；不得自动重新开始播放，也不得把 cinematic 临时姿态写回作者数据。
- `stop()`、非循环自然结束、用户取消和 context lost 走同一个恢复事务：先清 Follow/Observe 临时显示，再恢复播放前编辑器 view、controls、Camera Control 与 path 状态；恢复函数只执行一次。离线导出调用 `prepareOfflineCapture()` 时先停止预览，导出结束后仍保持 stopped，等待用户显式播放。
- 项目新建、加载、Storage/snapshot 恢复时调用 `load()`；缺少字段恢复默认空 clip，旧项目兼容由 `domain/animation` 完成。Camera Control 不属于项目格式，加载后必须清空。

**依赖**：domain/animation、camera-controller、camera-control、three-renderer、overlays、util/math。
