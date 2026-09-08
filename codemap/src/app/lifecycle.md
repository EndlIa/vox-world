# lifecycle.ts

**职责**：管理编辑器初始化、运行、暂停、恢复和释放顺序，并统一处理页面可见性、卸载与渲染上下文丢失。

**接口**：`initialize(editor, hostEvents)`、`start()`、`pause(reason)`、`resume()`、`handleContextLost()`、`handleContextRestored()`、`flushBeforeUnload()`、`dispose()`。

**内部**：
- 状态机固定为 `created → starting → running ↔ paused → disposed`；重复 `start/resume/dispose` 必须幂等。
- 订阅 `visibilitychange`：隐藏时停止帧循环、暂停动画/预览和后台采样，并请求 ProjectService 尽力刷新待写状态；恢复时只有状态健康且上下文可用才重启帧循环。
- 订阅 `pagehide`/`beforeunload`：同步移除输入监听、取消未完成任务、释放 object URL 和定时器，并调用可同步完成的保存钩子；不得把异步保存当作卸载保证。
- 渲染上下文丢失时立即暂停渲染、拾取和依赖 GPU 的预览，保留 `VoxelDocument`、Selection、History 和项目数据；恢复时让 renderer 依据当前状态重建 GPU 资源，再恢复帧循环。
- 页面卸载和 `dispose()` 都必须释放 renderer、UI、input、worker、平台监听器和资源；释放顺序与创建顺序相反。
- 错误不能吞掉：context restore 失败保持 paused 并报告，dispose 继续执行其余清理。

**边界**：不实现渲染资源重建、不写项目格式、不决定 autosave 策略；只调用相应端口并协调时序。

**依赖**：editor-session、renderer 生命周期钩子、platform host events、project-service。

