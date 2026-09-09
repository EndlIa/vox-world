# three-renderer.ts

**职责**：实现应用层 `RendererPort` 与 `AnimationApplyPort`，并作为编辑器主视口的 Three.js/WebGL 渲染适配器。它是唯一持有编辑器 `WebGLRenderer`、主帧循环、上下文状态和视口尺寸的模块；不拥有体素领域状态、动画数据、相机编辑规则或持久化数据。

**接口**：
- `RendererPort`：`mount`、`resize`、`render`、`applyPatch`、`setSelection`、`setPreview`、`dispose`。
- 渲染能力接口：`applyRenderSettings`、`getRenderCapabilities`、`setToneMapping`、`invalidate`、`requestRender`。
- 相机/截图能力接口：`getActiveCameraSnapshot`、`setActiveCameraSnapshot`、`captureFrame`、`onContextStateChange`。
- `AnimationApplyPort`：`applyEvaluation(evaluation)`、`clearEvaluation()`；`evaluation` 是 `domain/animation` 产生的只读 `AnimationEvaluation`。
- `captureFrame(options)` 返回 `Promise<Blob>`；`options` 包含 `width`、`height`、`transparent`、`source` 和可选的 `samples`。
- `onContextStateChange(listener)` 发出 `{ status: 'lost' | 'restoring' | 'restored' | 'failed', reason? }`。

**内部**：
- 创建 `WebGLRenderer`，设置尺寸、像素比、阴影、颜色空间和输出色彩空间；主视口默认透明清屏，具体背景由 `scene.ts` 控制。
- 使用统一的应用渲染调度器，不允许渲染器、动画播放和 Sandbox 各自创建互不协调的长期 `requestAnimationFrame` 循环。编辑器、Sandbox 与离线捕获通过 `requestRender` 串行驱动。
- `applyPatch` 消费 `ScenePatch`，按 `SceneNodeId`/`VoxObjectId` 更新 authored/base 节点层级、局部变换和对象实例资源；不得把所有对象合并成一个无身份的全局面缓冲。补丁只修改 `SceneDocument` 的 base transform，应用后必须用当前动画覆盖重新计算有效局部/世界矩阵。
- `applyEvaluation` 是播放和离线渲染共用的唯一运行时应用入口：先校验所有目标节点存在且非根、通道值合法，并在暂存结构中构造本次完整有效状态；校验全部通过后再按稳定顺序提交到 `scene`，存在 `evaluation.camera` 时同时提交到 `camera-controller`，否则清除相机覆盖。提交过程必须可回滚或等价原子，全部成功后请求重绘；失败时不得留下半应用状态。本方法只消费 `AnimationEvaluation`，不调用 `evaluateAnimation`。
- 节点覆盖只表达相对父节点的局部 `position`、`rotation`、`scale` 通道；每个通道未出现时沿用 `SceneDocument` 的 authored/base 值，出现时替换该通道。有效局部矩阵为 `T * R * S`，世界矩阵由有效父矩阵逐级组合，子节点必须继承父节点动画结果。
- 相机覆盖只驱动当前活动相机的位置、四元数和垂直 FOV，不修改项目 `camera` 设置。存在相机轨道时，Follow 播放由 cinematic camera 接收覆盖；只有节点轨道时相机保持 authored/base view。
- `clearEvaluation()` 必须幂等地清除全部节点覆盖和相机覆盖，使场景与相机恢复到 `SceneDocument` 和项目相机设置的 authored/base 状态。停止播放、项目加载/切换、项目新建和 dispose 必须调用；加载新项目时不得让旧覆盖泄漏到新场景。
- 渲染器绝不把 `AnimationEvaluation` 写回 `SceneDocument`、`AnimationDocument`、History 或项目 JSON。播放和离线渲染不得推进 `SceneDocument.version` 或项目 dirty 版本。
- `RendererPort` 继续只承接文档同步、选择/预览等应用层核心能力。相机取景、PBR 设置、路径追踪和截图通过独立能力接口暴露，避免把 Three.js 类型或 UI 设置塞进领域同步端口。
- 管理 tone mapping 枚举：`none`、`linear`、`reinhard`、`cineon`、`acesFilmic`、`agx`、`neutral`。编辑器预览和 Sandbox 使用同一份设置；PathTracer 重配时同步重置采样。
- `captureFrame` 必须以调用方指定的活动相机渲染，不得硬编码编辑器相机；只读取当前已经应用的运行时求值，不执行动画求值。调用前后恢复 `renderer` 尺寸、清屏色、后处理附着状态和活动相机。
- **Context Lost 恢复是必需功能**：监听 `webglcontextlost` 时调用 `preventDefault()`，立即暂停帧循环、路径追踪和离线捕获，清除动画覆盖，向外发 `lost`；保留 CPU 侧设置、相机快照、体素实例源数据和待恢复渲染标记，不重建领域文档。
- 监听 `webglcontextrestored` 时依次重建 renderer 资源、材质/program、render target、后处理、实例缓冲和 GPU 拾取资源，随后重新同步 `voxel-instances`、恢复 authored/base 场景与相机设置，并发出 `restored`。恢复后播放保持停止，必须由用户重新开始；恢复失败时保持只读可见状态并发出 `failed`，不得继续使用失效 GPU 句柄。
- 上下文丢失期间截图或动画导出必须以明确的 `renderer-context-lost` 错误取消，并在恢复后由服务层重新发起，不能在丢失上下文中排队无界任务。

**依赖**：three、application/ports/animation-port、application/ports/renderer-port、scene、voxel-instances、overlays、post-pipeline、picker、camera-controller、domain/animation、domain/scene/scene-types、domain/scene/scene-patch。
