# path-tracer.ts

**职责**：封装 `three-gpu-pathtracer` 的 `WebGLPathTracer`，管理渐进采样、场景失效、暂停/恢复和进度；只消费 Sandbox 的 Three.js 场景与规范化渲染设置，不拥有 UI、项目格式或体素数据。

**接口**：
- `create(scene, camera, settings)`、`configure(settings)`、`dispose()`。
- `start()`、`pause()`、`resume()`、`stop()`、`reset()`、`renderSample()`、`isComplete()`、`getProgress()`。
- 失效接口：`invalidateCamera()`、`invalidateEnvironment()`、`invalidateLights()`、`invalidateMaterials()`、`invalidateScene()`。
- 事件：`onProgress({ samples, maxSamples, bounces, elapsedMs, complete })`、`onStateChange({ status: 'idle' | 'rendering' | 'paused' | 'complete' | 'failed' })`。

**内部**：
- 创建 `WebGLPathTracer` 时设置 `bounces = 1`、`renderDelay = 100`、`fadeDuration = 250`、`minSamples = 1`、`renderToCanvas = true`、初始纹理尺寸 `512x512`、初始 tiles `1x1`、`dynamicLowRes = true`、`lowResScale = 0.5`。
- 规范化设置必须覆盖 `samples`、`bounces`、`renderScale`、`tiles`：默认分别为 `512`、`1`、`0.8`、`4`；`samples` 最小 `8` 且按整数接受，`bounces >= 1`，`tiles >= 1`，`renderScale` 限制在 `0.1..1`。项目只使用 `renderScale`，不得产生两个独立设置所有者。
- 每次只调用一次 `renderSample()`，由统一调度器按帧推进；不得在模块内另建长期动画循环。达到 `samples` 后停止采样但保留最终图像，重新开始前必须 `reset()`。
- `configure` 变更 samples、bounces、renderScale 或 tiles 后必须重置累积采样并重新创建/更新 PathTracer 状态；相机、环境、灯光、材质或场景变化分别调用对应 `update*`，不得整场景无条件重建。
- `pause()` 保留已积累的样本和进度；`resume()` 从当前样本继续；`stop()` 停止采样并把进度归零；`reset()` 清空 GPU 累积缓冲但保留场景、相机和设置。暂停状态在窗口隐藏、Sandbox 停用和 context lost 时保持可恢复。
- 截图请求可强制推进一个 sample；其余情况不得为了截图无限等待完整 `samples`。进度至少包含当前样本、目标样本、bounce 数和耗时，供 `editor-view-model` 展示，不直接操作 DOM。
- `three-gpu-pathtracer` 初始化失败、shader 编译失败或 WebGL context lost 时进入 `failed`/停止状态，保留可重建参数并允许恢复；不得继续提交采样。`dispose()` 必须释放 PT 的 render targets 和内部资源。

**依赖**：three、three-gpu-pathtracer、sandbox-renderer、render-settings-service、util/disposable。
