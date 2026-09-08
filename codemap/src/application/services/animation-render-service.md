# animation-render-service.ts

**职责**：编排相机动画离线渲染用例，通过注入端口连接 UI 设置、平台文件选择、离线渲染器、PNG/MP4 writer、编辑器相机/覆盖层/后处理状态恢复和进度通知；不实现 Three.js 逐帧捕获、WebCodecs 编码或领域插值。

**接口**：
- `getCapabilities(settings?): Promise<{ pngSequence: boolean; mp4: boolean; reasons?: string[] }>`。
- `render(options): Promise<{ cancelled: boolean; completed: number; totalFrames: number; output: 'png_sequence' | 'mp4'; destinationName?: string }>`。
- `cancel()`、`getStatus()`、`subscribe(listener)`。
- `options`：`frameStart`、`frameEnd`、`fps`、`width`、`height`、`transparent`、`filePrefix`、`output`。
- 事件：`{ phase: 'idle' | 'choosing-output' | 'preparing' | 'rendering' | 'finalizing' | 'cancelled' | 'failed'; completed; totalFrames; output?; message? }`。

**最小端口契约**：
- `AnimationRenderPort`：`validate(settings)`、`render(settings, writer)`、`cancel()`、`getStatus()`；实现方负责逐帧求值、捕获顺序和 writer 生命周期。
- `AnimationOutputPickerPort`：`pickDirectory(prefix)`、`pickFile(filename, mimeType)`；返回平台句柄或 `null`，不得在 service 内直接调用文件系统。
- `AnimationOutputPort`：`probe(format)`、`createPngSequenceWriter(handle, settings)`、`createMp4Writer(handle, settings)`；仅负责能力探测和构造 `AnimationOutputWriter`。
- `CameraAnimationPreviewPort`：`prepareOfflineCapture()` 返回幂等 `restore()`；负责停止预览并切换 cinematic camera，不修改动画数据。
- `RendererCapturePort`：`captureFrame({ width, height, transparent, source })`；只读取当前活动相机输出，不管理文件。
- `CaptureStatePort`：`suspendForCapture(options)` 返回幂等 `restore()`；负责 overlay、postFX 与编辑器交互临时状态。

**内部**：
- 开始前拒绝并发任务，调用 `validateAnimationRenderSettings`，并确认动画至少有一个关键帧。`mp4` 必须先通过 `AnimationOutputPort.probe()`；能力不足返回可展示原因并回退/提示 PNG，不打开文件句柄。
- 输出选择只发生一次：PNG 通过 `AnimationOutputPickerPort.pickDirectory()` 取得目录并创建 PNG writer；MP4 通过 `AnimationOutputPickerPort.pickFile()` 取得 writable 并创建 MP4 writer。用户取消选择器时返回 `cancelled: true`，不得进入 `prepare()` 或修改编辑器状态。
- 通过 `CameraAnimationPreviewPort.prepareOfflineCapture()` 停止现有播放、结束 Follow/Observe preview、隐藏 Camera Control/路径/keyframe marker，并切换为 cinematic camera；返回的 restore 是唯一编辑器状态恢复入口。服务不得自行复制或篡改关键帧。
- 捕获回调必须使用 `RendererCapturePort.captureFrame({ width, height, transparent, source: 'active-camera' })`。每次先由 renderer 应用离线求值状态，再捕获；截图/导出期间活动相机可能是 cinematic camera，禁止硬编码编辑器相机。
- 捕获前通过 `CaptureStatePort.suspendForCapture()` 隐藏选择框、hover、gizmo、路径和 marker；根据设置 suspend/保留后处理。无论成功、取消、异常或 context lost，都在 `finally` 恢复 overlay、postFX attach、相机 controls、Camera Control 可见性/选择状态和编辑器 view。
- PNG 与 MP4 共用同一 inclusive frame loop；writer 由 `AnimationRenderPort` 调用。服务只处理 writer 选择、capability 和进度映射，不直接计算文件编号、时间戳或编码参数。
- 取消时调用 `AnimationRenderPort.cancel()`；writer 负责 abort/close，服务等待当前捕获返回并确认 writer 已 finalize。取消是正常结果，保留已完成的 PNG 帧；MP4 取消应 abort 临时输出，不暴露不完整文件为成功。
- 失败时保留原始错误类别（设置错误、目录/保存权限、编码不支持、context lost、编码失败），发出 `failed` 事件并确保 `restore()` 已执行。context lost 期间不得继续排队帧；恢复后由用户重新发起。
- 离线渲染不使用 Sandbox GPU PathTracer，也不把当前 PathTracer sample 状态当作动画输出状态。播放状态属于预览，导出前停止且导出后不自动恢复播放；Camera Animation 数据和 Camera Control 作者态不得被修改。
- 服务不访问 DOM、不直接调用 WebCodecs、不创建 Three.js 对象，也不负责项目保存；UI 只通过 view model 消费状态和结果。

**依赖**：domain/animation、本文件定义的 `AnimationRenderPort`、`AnimationOutputPickerPort`、`AnimationOutputPort`、`CameraAnimationPreviewPort`、`RendererCapturePort`、`CaptureStatePort`、platform-port；具体渲染/编码适配器由 app composition root 注入。
