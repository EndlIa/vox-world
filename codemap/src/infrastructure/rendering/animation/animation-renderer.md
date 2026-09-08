# animation-renderer.ts

**职责**：执行确定性的相机动画离线渲染任务，负责帧范围、不可变动画快照、逐帧求值、进度、取消、输出 writer 生命周期和编辑器状态恢复钩子；不访问 DOM，不直接持有 Three.js renderer，也不实现 PNG/MP4 编码细节。

**接口**：
- 本文件定义 `AnimationOutputWriter`：`addFrame(blob, metadata): Promise<void>`、`finalize({ cancelled }): Promise<AnimationOutputResult>`、`abort(reason?): Promise<void>`。`metadata` 至少含 `frame`、`totalFrames`、`timestampUs`；writer 是唯一拥有输出句柄、文件命名和最终提交/回滚的对象。
- `validateAnimationRenderSettings(settings): boolean`。
- `render(settings): Promise<{ cancelled: boolean; skipped?: boolean; completed: number; totalFrames: number }>`。
- `cancel()`、`isRendering()`、`getState()`。
- 构造依赖：`{ animation, chooseOutput, prepare, captureFrame, onProgress, onStateChange }`；`chooseOutput` 必须返回本文件定义的 `AnimationOutputWriter`，不能返回裸流或编码器。
- `settings` 固定为 `{ frameStart, frameEnd, fps, width, height, transparent, filePrefix, output: 'png_sequence' | 'mp4' }`。
- `chooseOutput(settings, totalFrames)` 返回带 `addFrame(blob, metadata)` 和 `finalize({ cancelled })` 的 writer；用户取消文件选择时返回空值。

**内部**：
- 校验 `frameStart`、`frameEnd`、`width`、`height` 为整数，`fps`、尺寸为正有限数，`frameStart >= 0`、`frameEnd >= frameStart`；`filePrefix` 去除首尾空白后非空，且不得含 `\\/:*?"<>|`。非法设置抛出明确错误，不进入渲染。
- 没有 keyframe 时拒绝启动并提示先添加相机关键帧。已有任务运行时再次 `render()` 返回 `skipped: true`，不得并发创建第二个 writer。
- 开始前通过 `domain/animation` 深拷贝并规范化为独立 clip，强制 `loop = false`，确保渲染期间用户编辑关键帧不影响本次任务。帧范围包含首尾，`totalFrames = frameEnd - frameStart + 1`。
- 每帧时间固定为 `frame * 1000 / fps`，只调用同一个确定性 `evaluateCameraAnimation`。禁止另建插值器或依赖当前播放状态。
- 先取得 writer，再设置 `isRendering`、发出初始进度和调用 `prepare()`；`prepare()` 返回的 restore 必须在 `finally` 中执行一次，覆盖成功、取消、捕获失败、编码失败和 context lost。
- 帧循环顺序固定为：检查取消 → evaluate → `captureFrame(state, settings)` → 再次检查取消 → `writer.addFrame()` → 更新已完成帧数 → 让出事件循环。每帧完成后发出 `{ completed, totalFrames, frame }`。
- PNG 文件名由 renderer 统一生成：`${prefix}_${zeroPad(frame, max(6, digits(frameEnd)))}.png`。PNG writer 直接写入用户选择的目录，不生成 ZIP，也不提供独立“单帧渲染”入口。
- MP4 与 PNG 共用同一逐帧路径；`transparent` 只对 PNG 生效，MP4 必须按不透明输出处理。MP4 writer 在创建前负责 capability 检查。
- renderer 是 `AnimationOutputWriter` 的唯一调用者；application service 只注入 `chooseOutput` 工厂，不得直接调用 `addFrame`、`finalize` 或 `abort`。取消后停止取帧，并以 `{ cancelled: true }` 调用 writer finalize；普通完成以 `{ cancelled: false }` finalize。异常路径先调用 `writer.abort()`，再重新抛出原错误，保证已打开的文件流被 abort/close。
- `isRendering`、`cancelRequested` 和进度状态在 `finally` 复位。context lost 由 capture port 返回明确错误并取消任务；恢复后必须由用户或服务层重新发起，不能自动重放整个序列。
- 输出宽高是离线渲染设置，不写入 camera keyframe；keyframe 只保存垂直 FOV，捕获时按请求尺寸调整 aspect。

**依赖**：domain/animation、本文件定义的 `AnimationOutputWriter`、animation/png-sequence-writer、animation/mp4-writer、application/ports/renderer-port、application/ports/platform-port。
