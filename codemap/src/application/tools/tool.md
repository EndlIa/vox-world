# tool.ts

**职责**：定义编辑工具的最小交互状态机，以及所有工具共用的生命周期、手势和预览契约。

**接口**：
- `Tool`：`id`、`family`、`capabilities`、`activate`、`deactivate`、`pointerDown`、`pointerMove`、`pointerUp`、`pointerCancel`、`cancel`、`keyDown`。
- `ToolPointerEvent`：`pointerId`、`button`、`buttons`、`screen`、`modifiers`、`phase`、`gestureId`。
- `ToolCapabilities`：`editButton`、`freehand`、`rect`、`box`、`needsWorkplane`、`preview`、`selection`、`instant`。
- `ToolDraft`：本次手势累积的纯数据预览、命令意图、预览 token 和取消原因。

**内部**：
- 工具只把输入解释为 Command 或 ToolContext 预览请求，不执行命令、不直接改 `VoxelDocument`、`Selection`、DOM、Three.js 或 Worker。
- 一次编辑手势必须有唯一 `gestureId`。`pointerDown` 创建 Draft；`pointerMove` 只更新 Draft/预览；`pointerUp` 恰好提交一次命令；`pointerCancel`、Escape、窗口失焦或导航键抢占时丢弃 Draft 并清理预览。
- 左键（或配置的主编辑按钮）才是编辑按钮。中键、右键、滚轮、轨道旋转、平移和缩放属于导航，不得触发任何建模、选择或变换命令。导航开始时先调用 `cancel(reason: "navigation")`。
- 预览按工具能力选择 plane、cube、box、marquee 或 working-pick 高亮。预览是只读 Draft 的投影，不允许提交、写历史或修改领域状态。
- 工具在 `pointerDown` 时冻结对称轴、pivot、workplane 策略、Bypass 策略和 `baseVersion`；手势过程中设置变化只影响下一次手势。
- 同一手势内按稳定体素键去重；提交前再次过滤重复位置、不可见目标和越界目标。异步命令提交期间拒绝第二个提交，除非该工具明确支持取消。
- `deactivate` 必须等价于 `cancel("tool-switch")`，且不得隐式提交；切换工具时若存在未提交 XFORM，由 ToolRegistry/EditorSession 先按 XFORM 的显式规则 Apply 或要求用户处理。
- 预览和输入状态只保留内存，不进入项目序列化。

**依赖**：tool-context、commands、voxel-types、util/disposable。
