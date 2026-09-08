# three-renderer.ts

**职责**：实现应用层 `RendererPort`，并作为编辑器主视口的 Three.js/WebGL 渲染适配器。它是唯一持有编辑器 `WebGLRenderer`、主帧循环、上下文状态和视口尺寸的模块；不拥有体素领域状态、相机编辑规则或持久化数据。
**接口**：
- `RendererPort`：`mount`、`resize`、`render`、`applyPatch`、`setSelection`、`setPreview`、`dispose`。
- 渲染能力接口：`applyRenderSettings`、`getRenderCapabilities`、`setToneMapping`、`invalidate`、`requestRender`。
- 相机/截图能力接口：`getActiveCameraSnapshot`、`setActiveCameraSnapshot`、`captureFrame`、`onContextStateChange`。
- `captureFrame(options)` 返回 `Promise<Blob>`；`options` 包含 `width`、`height`、`transparent`、`source` 和可选的 `samples`。
- `onContextStateChange(listener)` 发出 `{ status: 'lost' | 'restoring' | 'restored' | 'failed', reason? }`。

**内部**：
- 创建 `WebGLRenderer`，设置尺寸、像素比、阴影、颜色空间和输出色彩空间；主视口默认透明清屏，具体背景由 `scene.ts` 控制。
- 使用统一的应用渲染调度器，不允许渲染器、动画播放和 Sandbox 各自创建互不协调的长期 `requestAnimationFrame` 循环。编辑器、Sandbox 与离线捕获通过 `requestRender` 串行驱动。
- `RendererPort` 继续只承接文档同步、选择/预览等应用层核心能力。相机取景、PBR 设置、路径追踪和截图通过独立能力接口暴露，避免把 Three.js 类型或 UI 设置塞进领域同步端口。
- 管理 tone mapping 枚举：`none`、`linear`、`reinhard`、`cineon`、`acesFilmic`、`agx`、`neutral`。编辑器预览和 Sandbox 使用同一份设置；PathTracer 重配时同步重置采样。
- `captureFrame` 必须以调用方指定的活动相机渲染，不得硬编码编辑器相机；调用前后恢复 `renderer` 尺寸、清屏色、后处理附着状态和活动相机。
- **Context Lost 恢复是必需功能**：监听 `webglcontextlost` 时调用 `preventDefault()`，立即暂停帧循环、路径追踪和离线捕获，向外发 `lost`；保留 CPU 侧设置、相机快照、体素实例源数据和待恢复渲染标记，不重建领域文档。
- 监听 `webglcontextrestored` 时依次重建 renderer 资源、材质/program、render target、后处理、实例缓冲和 GPU 拾取资源，随后重新同步 `voxel-instances`、恢复相机与设置，并发出 `restored`。恢复失败时保持只读可见状态并发出 `failed`，不得继续使用失效 GPU 句柄。
- 上下文丢失期间截图或动画导出必须以明确的 `renderer-context-lost` 错误取消，并在恢复后由服务层重新发起，不能在丢失上下文中排队无界任务。

**依赖**：three、application/ports/renderer-port、scene、voxel-instances、overlays、post-pipeline、picker。
