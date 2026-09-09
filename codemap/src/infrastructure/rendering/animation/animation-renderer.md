# animation-renderer.ts

**职责**：执行统一 `AnimationDocument` 的确定性离线渲染任务，负责冻结动画文档、校验渲染设置与场景引用、帧范围、逐帧求值、应用节点与相机覆盖、进度、取消、消费传入 writer 并恢复编辑器状态；不访问 DOM，不选择或创建输出，不直接持有 Three.js renderer，也不实现 PNG/MP4 编码细节。

**接口**：
- `validate(settings)`：校验渲染设置以及当前冻结的 `AnimationDocument`，返回明确可展示结果；不得选择输出或修改运行时状态。
- `render(settings, writer: AnimationOutputWriter): Promise<{ cancelled: boolean; skipped?: boolean; completed: number; totalFrames: number }>`；writer 由 application service 通过 `AnimationOutputPort` 创建后传入。
- `cancel()`、`isRendering()`、`getState()`。
- 构造依赖：`{ animation, scene, prepare, applyEvaluation, captureFrame, onProgress, onStateChange }`；`animation` 是当前 `AnimationDocument` 的只读快照来源，`scene` 是当前 `SceneSnapshot` 的只读来源，`prepare` 是 `AnimationPreviewPort.prepareOfflineCapture`，`applyEvaluation` 是 `AnimationApplyPort`，`captureFrame` 来自 `RendererCapturePort`。
- `settings` 固定为 `{ frameStart, frameEnd, fps, width, height, transparent, output: 'png_sequence' | 'mp4' }`；`filePrefix` 只属于 writer 创建和输出选择，不进入 renderer。
- 本文件不定义 `AnimationOutputWriter`、metadata、result 或选择 writer 的回调；这些公共 DTO 的唯一 owner 是 `application/ports/animation-port`。

**内部**：
- 校验 `frameStart`、`frameEnd`、`width`、`height` 为整数，`fps`、尺寸为正有限数，`frameStart >= 0`、`frameEnd >= frameStart`。非法设置返回明确错误，不进入渲染。
- `validate(settings)` 必须冻结当前 `AnimationDocument`，通过 `domain/animation.validateAnimation(document, sceneSnapshot)` 校验文档非空、每条轨道至少一个关键帧、关键帧合法、Node target 存在且不是根节点、Node/Camera target/channel 合法；不得只检查相机轨道或依赖 UI 已校验。已有任务运行时再次 `render()` 返回 `skipped: true`，不得并发创建第二个任务。
- `render()` 开始时重新冻结并校验文档，强制 `loop = false`，确保渲染期间用户编辑轨道或关键帧不影响本次任务。节点轨道仍只保存相对父节点的局部 TRS，相机轨道保存相机状态；帧范围包含首尾，`totalFrames = frameEnd - frameStart + 1`。
- renderer 只消费 application service 传入的 writer；不调用 picker、不创建输出句柄、不推导文件名策略。writer 的 `addFrame`、`finalize`、`abort` 调用必须由 renderer 串行管理。
- 每帧时间固定为 `frame * 1000 / fps`，只调用同一个确定性 `domain/animation.evaluateAnimation(document, timeMs)`。禁止分别调用节点/相机求值器、另建插值器或依赖当前播放状态；Node 与 Camera 轨道共享这一个时间轴。
- 每帧必须按固定顺序处理同一个 `AnimationEvaluation`：检查取消 → `evaluateAnimation` → `applyEvaluation(evaluation)` → `captureFrame(settings)` → 再次检查取消 → `writer.addFrame(blob, { frame, totalFrames })` → 更新已完成帧数 → 让出事件循环。节点局部 TRS 覆盖和相机覆盖必须来自同一次求值，不能跨帧拼接。
- 在设置和文档校验通过后设置 `isRendering`、发出初始进度并调用 `prepare()`；`prepare()` 返回的 restore 必须在 `finally` 中执行一次，覆盖成功、取消、捕获失败、编码失败和 context lost。
- 帧捕获必须使用当前活动相机。`prepare()` 停止交互预览、清除全部运行时 override并恢复 authored/base view，再切换 cinematic camera；存在相机轨道时相机覆盖驱动它，只有节点轨道时它以捕获前的 authored view 初始化。`captureFrame` 只捕获已应用的运行时状态，不负责动画求值。
- `applyEvaluation()` 只修改运行时 Three.js 场景图和活动相机，绝不写回 `SceneDocument`、`AnimationDocument`、History 或项目 JSON。每帧覆盖替换上一帧的完整求值结果；`finally` 必须先调用 `applyEvaluation.clearEvaluation()` 清除节点和相机覆盖，再执行 `prepare()` 返回的 restore。
- PNG 与 MP4 共用同一逐帧路径；`transparent` 只对 PNG 生效，MP4 必须按不透明输出处理。renderer 不执行 capability 探测，writer 已在 service 选择输出前完成检查。
- 取消后停止取帧，并以 `{ cancelled: true }` 调用 `writer.finalize()`；普通完成以 `{ cancelled: false }` 调用 `finalize()`。异常路径先调用 `writer.abort()`，再重新抛出原错误，保证已打开的文件流被 abort/close。renderer 是传入 writer 的唯一调用者，service 不直接调用 writer 方法。
- `isRendering`、`cancelRequested` 和进度状态在 `finally` 复位。context lost 由 capture port 返回明确错误并取消任务；恢复后必须由用户或服务层重新发起，不能自动重放整个序列。
- 输出宽高是离线渲染设置，不写入动画轨道；相机轨道的 FOV 是垂直 FOV，捕获时按请求尺寸调整 aspect。

**依赖**：application/ports/animation-port、domain/animation、domain/scene/scene-types、application/ports/renderer-port。
