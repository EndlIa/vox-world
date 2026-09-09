# mp4-timing.ts

**职责**：提供统一 `AnimationDocument` 离线 MP4 的确定性帧时间戳计算，作为 WebCodecs 和测试共享的纯函数。
**接口**：`getAnimationFrameTimestampUs(frame: number, fps: number): number`。
**内部**：返回 `Math.round(frame * 1_000_000 / fps)`；不读取时钟、不处理取消、不依赖 WebCodecs。动画求值时间仍由 renderer 按 `frame * 1000 / fps` 计算，Node/Camera 共享同一时间轴，本模块只生成 MP4 时间戳。`frame` 和 `fps` 的合法性由调用方在 render settings 边界验证。
**依赖**：无。
