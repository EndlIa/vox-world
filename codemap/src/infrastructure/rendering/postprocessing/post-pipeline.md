# post-pipeline.ts

**职责**：管理可选的编辑器后处理管线，并暴露可验证、可降级的参数；不保存项目文件，也不决定体素领域规则。
**接口**：
- `configure({ effect, samples })`、`resize`、`render`、`dispose`。
- `attach(targetCamera)`、`detach()`、`suspend()`、`resume()`、`isAttached()`。
- `getCapabilities()`、`getState()`、`restoreState(state)`。

**内部**：
- 支持的 `effect` 至少为 `none`、`outline`、`ssao`、`custom`；默认 `none`。`samples` 默认 `4`，限制为 `1..8`，移动端可降为 `2`。
- 管线需要 resize 和相机切换感知；当活动相机由 editor 切换到 cinematic/sandbox 时必须重新绑定或 suspend，禁止在错误相机上保留旧 render target。
- 能力不足、上下文丢失或 shader 编译失败时安全降级为 `none` 并报告一次诊断，不得阻塞编辑和渲染。
- 截图/离线导出可选择 `suspend()` 后捕获基础图像，或按明确设置包含后处理；无论成功、取消或失败，`screenshot-service` 和 `animation-render-service` 都必须恢复原 attach 状态。
- 后处理参数属于工作区偏好（`pref_scene_postfx`、`pref_scene_postfx_samples`），不属于项目 `render` 字段；设置服务通过偏好端口读写，post-pipeline 不直接访问 localStorage。

**依赖**：three、three postprocessing、three-renderer、camera-controller。
