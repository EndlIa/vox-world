# mp4-writer.ts

**职责**：将逐帧 PNG Blob 通过 WebCodecs 编码为 H.264，并使用 `mp4-muxer` 写入单个 MP4 文件；负责编码器能力检查、时间戳、backpressure 和 writer 收尾，不负责相机动画求值或用户文件选择。

**接口**：
- `H264_CODEC = 'avc1.42002A'`。
- `getH264EncoderConfig({ width, height, fps })`。
- `isMp4ExportSupported(settings): Promise<boolean>`。
- `createMp4Writer({ settings, writable, totalFrames }): AnimationOutputWriter`。
- 实现 `AnimationOutputWriter`：`addFrame(blob, { frame, totalFrames, timestampUs })`、`finalize({ cancelled }): Promise<AnimationOutputResult>`、`abort(reason?): Promise<void>`。

**内部**：
- H.264 配置固定为 codec `avc1.42002A`、请求的 width/height/framerate；bitrate 为 `clamp(round(width * height * fps / 10), 1_000_000, 20_000_000)`。
- 支持性检查同时要求 `VideoEncoder`、`VideoFrame`、`createImageBitmap`、`showSaveFilePicker` 和 `FileSystemWritableFileStream` 可用，并等待 `VideoEncoder.isConfigSupported(config)`。任一条件不满足返回 false；UI 必须禁用/隐藏 MP4 并回退 PNG，不能等编码开始后才失败。
- 使用一个 `VideoEncoder` 和一个 `Muxer`。Muxer 的 video codec 为 `avc`，尺寸取自 settings，`fastStart.expectedVideoChunks = totalFrames`，目标为调用方提供的 writable。MP4 只包含视频轨道，不创建音频轨道。
- `addFrame` 用 `createImageBitmap(blob)` 生成 `VideoFrame`；时间戳为 `Math.round(frame * 1_000_000 / fps)` 微秒，duration 为 `Math.round(1_000_000 / fps)` 微秒。仅 `frame === frameStart` 编码为 keyframe。
- 编码后按需 `encoder.flush()` 控制队列（`encodeQueueSize > 2` 时刷新）；无论成功失败都关闭 `VideoFrame` 和 `ImageBitmap`。编码器 `error` 回调保存错误，下一次 `addFrame` 或 finalize 必须抛出，不能静默生成损坏文件。
- 正常 finalize 先 flush encoder、检查错误，再 `muxer.finalize()` 并关闭 writable。取消 finalize 关闭 encoder 并 `writable.abort()`；finalize 必须幂等。任何失败都保留原始错误，让 renderer 恢复编辑器状态。
- `settings.transparent` 对 MP4 无效；MP4 始终按不透明视频输出。Render Scale/DPR 只影响 Sandbox PathTracer 预览，不改变离线 MP4 的请求 width/height。

**依赖**：WebCodecs、mp4-muxer、animation/mp4-timing、animation-renderer 的 writer 契约。
