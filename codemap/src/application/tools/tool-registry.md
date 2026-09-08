# tool-registry.ts

**职责**：注册、校验、查询和切换工具，并管理工具家族元数据。

**接口**：`register`、`unregister`、`get`、`list`、`activate`、`deactivate`、`active`、`families`。

**内部**：
- 每个工具注册稳定的 `id`、`family`、按钮策略、预览类型、选择策略和 workplane 能力；行为判定必须读取这些元数据，不能按工具名散落 `if`。
- 内置 family 至少包含：`freehand`、`box`、`rectangle`、`bridge`、`bucket`、`pick-color`、`selection`、`transform`、`visibility`、`measure`、`camera`。
- 激活前调用旧工具的 `cancel("tool-switch")` 并清理预览和指针捕获。切换到非 XFORM 工具时，若 XFORM 会话存在，先走 XFORM 的统一 Apply/取消门禁，再激活新工具。
- 重复 id、未知命令能力或缺少必要端口时注册失败并返回 Result，不留下半注册状态。
- 工具切换不得修改 VoxelDocument、Selection 或 History；它只改变当前交互状态。

**依赖**：tool、tool-context、util/result。
