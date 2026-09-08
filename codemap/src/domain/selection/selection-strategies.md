# selection-strategies.ts

**职责**：定义 Box、Rectangle、Color、Island、Visible 五种选择策略的纯候选解析规则。

**接口**：
- `SelectionStrategy` 可辨识联合：`box`、`rectangle`、`color`、`island`、`visible`。
- `resolveSelection(strategy, readView, input) -> SelectionResolution`。
- `SelectionResolution`：`keys`、`anchor?`、`excludedHidden`、`truncated?`、`warnings`。

**内部**：
- Box：输入闭区间整数 Bounds，返回其中已存在体素键；是否纳入隐藏体素由 `includeHidden` 明确指定，默认只选可见。
- Rectangle：输入屏幕矩形、投影候选键和 surfaceKeys。XFORM 活动时候选位置必须由调用方先用 `TransformSession.candidatePosition` 投影；`bypass = false` 时与 surfaceKeys 求交，`true` 时保留全部屏幕候选深度。
- Color：输入规范化颜色，返回精确同色键；默认只选可见体素。颜色即逻辑组，不按岛屿拆分。
- Island：输入种子键、连通性、`includeHidden`。默认使用可见 6 邻域；`Add Connected` 使用 26 邻域。种子不存在或隐藏时返回空集合。
- Visible：返回当前所有可见键；不得依赖 render-target 可见表面，隐藏与视锥外体素仍属于 Visible 选择。
- 所有策略返回去重、稳定排序的稳定键。策略不修改 Selection/TransformSession，不生成 Patch；写入选择由 TransformCommandHandler 完成。
- XFORM Add 模式需过滤 session 内已选 entry 和重复 working position；Subtract 模式只保留当前 session 成员。该过滤属于 XFORM 命令规则，不属于通用选择策略。

**依赖**：voxel-types、voxel-query、util/math。
