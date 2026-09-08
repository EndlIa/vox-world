# screenshot-service.ts

**职责**：统一编辑器、Sandbox、PathTracer 和动画预览中的截图用例，负责选择活动相机、临时隐藏/恢复覆盖层与后处理、按请求尺寸捕获、生成文件名和通过平台端口交付 Blob；不实现 Three.js 渲染或项目持久化。

**接口**：
- `capture(options?): Promise<ScreenshotResult>`。
- `captureThumbnail({ width, height }): Promise<Blob>`。
- `cancel()`、`isCapturing()`。
- `options`：`source?: 'active' | 'editor' | 'sandbox'`、`width?`、`height?`、`scale?`、`transparent?`、`includePostProcessing?`、`includeOverlays?`、`sink?: ScreenshotSink`。
- `ScreenshotResult` 至少包含 `blob`、`width`、`height`、`filename`、`source`。
- `ScreenshotSink` 由调用方注入 `write(blob, { filename })`；未提供时通过平台端口触发下载。

**最小端口契约**：
- `RendererCapturePort`：`captureFrame({ width, height, transparent, source: 'active-camera' | 'editor-camera' })`，负责读取编辑器/cinematic camera 的当前渲染结果。
- `SandboxCapturePort`：`captureFrame({ width, height, transparent })`，负责 Sandbox/PathTracer 独立 renderer 的捕获；PathTracer 运行时先完成当前 sample。
- `CaptureStatePort`：`suspendForCapture({ includePostProcessing, includeOverlays })` 返回幂等 `restore()`；负责 overlay、Camera Control、路径/marker、选择/hover/gizmo 与 postFX attach 状态的暂停和恢复。

**内部**：
- 默认 `source = active`、`scale = 4`、`includePostProcessing = true`、`includeOverlays = false`。尺寸优先使用显式 width/height，否则使用当前 viewport 乘 scale；最终尺寸必须是正整数并受平台最大纹理/画布限制。
- 截图必须使用当前活动相机：编辑器相机、cinematic camera 或 Sandbox 相机均可。动画 Follow/Observe 播放期间不得退回固定编辑器相机；Sandbox 已激活时委托 `SandboxCapturePort.captureFrame()`；该适配器在 PathTracer 已启动时先推进/完成一个 sample 再读取 canvas。
- 编辑器路径通过 `RendererCapturePort.captureFrame()` 捕获；调用前通过 `CaptureStatePort` 按选项暂停/隐藏 post-processing、axis view、grid、gizmo、选择/hover、Camera Control、路径和 marker。所有临时状态在 `finally` 中恢复，失败和取消也不能留下隐藏或 detached 状态。
- `transparent = true` 时使用 alpha 清屏并保留 PNG alpha；否则使用工作区背景偏好 `pref_background_check`/`pref_background_color` 或当前场景背景。Sandbox 的 HDRI 背景是否可见仍由当前 Sandbox 设置决定。
- 普通截图默认文件名 `${projectName}_${YYYY-MM-DD}_${random4}.png`；缩略图使用调用方稳定名称和 `captureThumbnail` 的无后处理路径，避免把编辑器 UI 辅助对象写入缩略图。文件名只允许安全字符，空项目名回退 `untitled`。
- `captureThumbnail` 强制 `includePostProcessing = false`、`includeOverlays = false`，按请求宽高生成不透明 PNG，供 Storage/snapshot 使用；失败返回错误，不写入损坏槽位。
- 取消、context lost、GPU readback 失败或 sink 写入失败时停止后续工作并恢复状态；context lost 返回明确错误，恢复后由用户重试。重复取消和重复 dispose 必须幂等。
- 服务不直接操作 DOM、不打开文件选择器、不修改项目 dirty 状态；下载、剪贴板和文件系统由平台端口提供。

**依赖**：本文件定义的 `RendererCapturePort`、`SandboxCapturePort`、`CaptureStatePort`、preferences 端口、platform-port；具体 Three.js 适配器由 app composition root 注入。
