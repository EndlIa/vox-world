# selection-strategies.ts

**职责**：定义 Edit 模式中活动 `SceneObject` 内部 Box、Rectangle、Color、Island、Visible 五种体素选择策略的纯候选解析规则（Island 与 Visible 策略【暂不实现】）。

**接口**：
- `SelectionStrategy` 可辨识联合：`box`、`rectangle`、`color`；`island`、`visible`【暂不实现】。
- `resolveSelection(strategy, snapshot, input) -> SelectionResolution`。
- `SelectionResolution`：`keys`、`anchor?`、`truncated?`、`warnings`；`excludedHidden`【暂不实现】。

**内部**：
- `resolveSelection` 接收对应的局部 `UniformVoxSnapshot`，消费 `query` 的懒序列并自行物化输出（`SelectionResolution.keys` 是数组）；返回的键只解释为该对象的局部 `VoxelKey`，写回同一对象的保证由调用方与写入侧负责（见 `voxel-selection` 的写入校验）。
- Box：输入局部 `Bounds3i`，返回其中已存在体素键；是否纳入隐藏体素由 `includeHidden` 指定、默认只选可见（`includeHidden` 与\“默认只选可见\”【暂不实现】）。
- Rectangle：输入屏幕矩形、投影候选键和 surfaceKeys。XFORM 活动时候选位置必须由调用方先用 `TransformSession.candidatePosition` 投影；`bypass = false` 时与 surfaceKeys 求交，`true` 时保留全部屏幕候选深度。
- Color：输入规范化颜色，返回精确同色键（\“默认只选可见\”【暂不实现】）。颜色即逻辑组，不按岛屿拆分。
- 【暂不实现】Island：输入种子键、连通性、`includeHidden`。默认使用可见 6 邻域；`Add Connected` 使用 26 邻域。种子不存在或隐藏时返回空集合。
- 【暂不实现】Visible：返回当前所有可见键；不得依赖 render-target 可见表面，隐藏与视锥外体素仍属于 Visible 选择。
- 所有策略返回去重、稳定排序的稳定键。策略不修改 Selection/TransformSession，不生成 Patch；写入选择由 TransformCommandHandler 完成。
- XFORM Add 模式需过滤 session 内已选 entry 和重复 working position；Subtract 模式只保留当前 session 成员。该过滤属于 XFORM 命令规则，不属于通用选择策略。
- 非活动对象不得进入候选、表面键求交或连通遍历；Rectangle 的投影候选必须来自活动对象。

**依赖**：types、query、util/math。
