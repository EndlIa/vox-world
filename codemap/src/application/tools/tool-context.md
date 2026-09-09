# tool-context.ts

**职责**：向工具提供受控的模式感知拾取、活动对象只读查询、工作平面、预览和命令提交能力。

**接口**：
- `pick(request)`、`pickMany(request)`、`surfaceKeysInRect(rect)`：返回普通 `PickResult` 或活动对象的局部稳定体素键，不暴露 GPU/Three.js 对象。
- `query`：仅查询 `EditorState.activeObjectId` 对应的 `VoxelReadView`；提供 `bounds`、`has`、`visibleKeys`、`byColor`、`island`、`withinBox`、`candidatePosition`。
- `workplane`：`mode`、`snap(point)`、`supportedBy(toolId)`、`getFloor/Volume/MultiPlane`、`setMultiPlane(axis, position)`、`rotateMultiPlane(axis)`、`resetMultiPlane()`、`getSliceY()`、`setSliceY(value)`。
- `preview`：`showPlane`、`showCube`、`showBox`、`showMarquee`、`showWorking`、`clear`。
- `dispatch(command)`、`cancelOperation(operationId)`、`confirm(request)`、`settings.snapshot()`、`requestRender()`。

**内部**：
- Object 模式下 `pick` 只返回对象命中；Edit 模式下只返回活动对象的局部体素命中。工作平面命中返回离散网格点，工具不得自行读取渲染器实例表。
- `surfaceKeysInRect` 在矩形手势开始或结束时只获取活动对象在当前 render-target 可见的局部体素键。命令携带该集合和全深度候选集合，由 Handler 根据 Bypass 策略过滤，避免 application handler 依赖渲染实现。
- `candidatePosition(candidateOrEntry)` 对 XFORM working entry 必须返回 `workingPosition + 未刷新的 rootDelta`。Box、Rect、Color、Island 和 Visible 选择只能通过此接口解析屏幕位置；不得直接读取 `workingPosition`。
- 工作平面模式包括 `auto`、`workplane-only`。`workplane-only` 只允许 Add、Box Add、Box Remove、Box Paint；其他工具不得在平面上起笔。Add 可从已有体素表面、工作平面或无体素的工作平面点起笔，结果必须为整数网格位置。
- MultiPlane 是一个可旋转的三轴工作平面组：默认位置 `(-0.5, -0.5, -0.5)`，可绕 X/Y/Z 旋转 90 度并可重置；只改变交互平面，不修改体素、Selection、History 或项目数据。`getSliceY/setSliceY` 与 Y 方向可见性切片使用同一整数坐标换算，正数对应 `y = value - 1`、负数对应 `y = value`，`0` 表示恢复全部可见。
- 命令携带的 `WorkplaneSnapshot` 为 `{ mode: "auto" | "workplane-only"; kind: "none" | "floor" | "volume" | "multi"; plane?: { axis, position } }`；快照在手势开始时冻结，工具过程中不得回读可变 workplane 状态。
- `dispatch` 只接收不可变命令，返回 `CommandOutcome`；长任务通过 `operationId` 订阅进度并支持取消。工具不自行重试或回滚，失败统一显示 Handler 的 Result。
- `settings.snapshot()` 在手势开始时复制 `mode`、`activeObjectId`、Bypass、Add Wall 高度、Island 连通性和 Clone 等设置。手势内不得读取可变 UI 单例；Edit 工具若发现活动对象已变化必须取消手势。
- `preview.clear()` 必须幂等；工具停用、手势取消、导航抢占、渲染上下文丢失和页面卸载时均调用。
- `confirm` 仅用于不可逆或大范围操作，例如 Paint All、Normalize、Centralize、Optimize、Resample、Fill Holes、Group by Islands、Delete Hidden；确认被拒绝时不得产生命令或历史项。

**依赖**：pick-service、scene-query、voxel-query、scene-commands、voxel-commands、voxel-transform-command、model-commands、generator-commands、editor-state、ports、util/result。
