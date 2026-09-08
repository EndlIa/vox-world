# sandbox-renderer.ts

**职责**：实现与编辑器主视口隔离的 Three.js Sandbox 渲染会话，拥有自己的 `WebGLRenderer`、场景、相机、OrbitControls、灯光/HDRI 绑定和可选 GPU PathTracer；不修改体素领域状态，不负责项目编解码，也不包含 TRELLIS2 的 render-only 分支。

**接口**：
- 生命周期：`initialize(host, settings)`、`activate(options)`、`deactivate()`、`resize(width, height, pixelRatio)`、`dispose()`、`getState()`、`onStateChange(listener)`。
- 场景同步：`syncSnapshot(snapshot, settings)`、`updateMeshes(snapshot)`、`updateMaterials(settings)`、`updateEnvironment(settings)`、`updateLighting(settings)`、`updatePlane(settings)`、`setShadeMode(mode)`、`invalidate(reason)`。
- 相机：`syncCamera(view)`、`captureCameraView()`、`frameCamera(bounds?)`、`setProjection(projection)`、`setView(preset)`、`setDof({ fStop, focalLength })`。
- PathTracer：`startPathTracing()`、`pausePathTracing()`、`resumePathTracing()`、`stopPathTracing()`、`getRenderProgress()`。
- 截图：`captureFrame(options): Promise<Blob>`；调用方通过 `screenshot-service` 提供尺寸、透明背景和文件名策略。
- 状态事件：`{ status: 'inactive' | 'activating' | 'active' | 'paused' | 'deactivating' | 'context-lost' | 'failed', pathTracer? }`。

**内部**：
- 使用独立 canvas 和 `WebGLRenderer`，启用抗锯齿、alpha 清屏、PCF 阴影；不得与编辑器主 renderer 共用 WebGL context、render target 或长期 `requestAnimationFrame`。激活时暂停编辑器主帧循环，停用后恢复，所有帧由统一渲染调度器串行驱动。
- 透视相机使用 Three.js `PhysicalCamera`，初始垂直 FOV 为 `45deg`，随后以项目的弧度 FOV、F-Stop 和 Focal Length 同步；近裁剪面为 `1`，远裁剪面为移动端 `2000`、桌面 `5000`。正交相机初始范围以高度 `100`（上下各 `50`）按 aspect 扩展，近裁剪面 `0.1`，切换投影时保留位置、朝向和取景中心。
- 相机是编辑器与 Sandbox 的双向适配器：激活时从 `camera-controller.captureView()` 取位置、四元数、目标、投影和正交视锥；Sandbox 内 OrbitControls 改变相机时更新 PathTracer 并回写只读 view。停用时把 Sandbox 的位置和目标回写到编辑器相机，但不写回项目文件。
- 场景从当前 `VoxelSnapshot` 重建静态 mesh buffer；黑色体素使用 emissive/shade 材质，其他体素使用带 vertex colors 的 `MeshPhysicalMaterial`。Shade Mode 只替换渲染材质，不改变体素颜色数据。所有 mesh 必须设置 frustum culling，并按设置接收/投射阴影。
- HDRI、环境强度、背景、背景模糊、方向光颜色/强度和平面必须从 `render-settings-service` 的规范化设置映射到 Sandbox 自己的 `Scene`；自定义 HDR 文件内容只保留在运行时缓存，设置中仅保存 mapId。任何环境、灯光或材质变化都调用 `path-tracer.invalidate()` 重置累积采样。
- 平面默认尺寸 `0`（关闭）、颜色 `#90A0B3`；开启时位于模型最低 Y 下方 `0.5`，接收阴影但不改变模型边界。阴影地面仅在标准渲染模式可见，PathTracer 模式下隐藏。
- `captureFrame` 必须使用当前活动的 Sandbox 相机；PathTracer 已启动时先推进一个可完成的 sample 再读取 canvas，否则直接渲染一帧。输出使用 PNG `toDataURL('image/png')` 或等价 Blob 转换，禁止硬编码编辑器相机。截图前后恢复 tone mapping、背景、平面和 PathTracer 暂停状态。
- 激活/停用必须幂等。停用、项目切换、上下文丢失和 `dispose` 均取消 PathTracer、停止 Sandbox 帧、释放 Sandbox 几何/材质/纹理/helper 和拾取对象，但不释放共享的体素领域数据。
- WebGL context lost 时立即停止标准渲染和 PathTracer，向 `onStateChange` 报告并保留 CPU 侧设置、相机 view、HDRI mapId 和体素快照；restored 后按这些数据重建 GPU 资源。恢复失败保持 inactive 并报告，不得复用失效 context 句柄。

**依赖**：three、three/examples OrbitControls、three-gpu-pathtracer、path-tracer、camera-controller、render-settings-service、domain/voxel/voxel-types、application/ports/renderer-port。
