# selection-strategies.ts

**职责**：定义 Edit 模式中活动 `SceneObject` 内部 Box、Rectangle、Color、Island、Visible 五种体素选择策略的纯候选解析规则（Island 与 Visible 策略【暂不实现】）。

**接口**：
- `SelectionStrategy` 自含的可辨识联合（载荷见类型形状）：`box`、`rectangle`、`color`；`island`、`visible`【暂不实现】。
- `resolveSelection(strategy, snapshot) -> SelectionResolution`。
- `SelectionResolution`：`keys`；`warnings`、`anchor?`、`truncated?`【暂不实现】；`excludedHidden`【暂不实现】（随可见性）。

**类型形状**：

```ts
export type SelectionStrategy =
  | Readonly<{ kind: "box"; bounds: Bounds3i }>
  | Readonly<{
      kind: "rectangle";
      projectedKeys: readonly VoxelKey[];
      surfaceKeys: readonly VoxelKey[];
      bypass: boolean;
    }>
  | Readonly<{ kind: "color"; color: ColorHex }>;

export type SelectionResolution = Readonly<{
  keys: readonly VoxelKey[];
}>;
// 挂起字段【暂不实现】：warnings（稳定 code 列表，触发条件未定义） | anchor? | truncated?
```

- 策略必须自含：`SelectVoxelsCommand.strategy` 是命令里唯一的寻址字段，任何候选（屏幕投影键、表面键）都随策略传递，不引入额外的 `input` 参数。`screenRect` 不进入策略——屏幕矩形只用于 tool/预览的投影，投影结果才是候选键。

**内部**：
- `resolveSelection` 接收对应的局部 `UniformVoxSnapshot`，消费 `query` 的懒序列并自行物化输出（`SelectionResolution.keys` 是数组）；返回的键只解释为该对象的局部 `VoxelKey`，写回同一对象的保证由调用方与写入侧负责（见 `voxel-selection` 的写入校验）。
- Box：输入局部 `Bounds3i`，返回其中已存在体素键；是否纳入隐藏体素由 `includeHidden` 指定、默认只选可见（`includeHidden` 与\“默认只选可见”【暂不实现】）。
- Rectangle：`projectedKeys` 与 `surfaceKeys` 由调用方给出（tool 的屏幕投影键与当前 render-target 表面键，均来自活动对象）；XFORM 活动时候选位置必须先经 `TransformSession.candidatePosition` 投影。`bypass = false` 时返回 `projectedKeys ∩ surfaceKeys`，`true` 时返回全部 `projectedKeys` 深度。矩形不按体素存在性过滤：Add 的目标本身就是空位置，存在性由写入侧按操作语义处理。
- Color：输入规范化颜色，返回精确同色键（\“默认只选可见”【暂不实现】）。颜色即逻辑组，不按岛屿拆分。
- 候选键的范围与对象归属由投影侧保证（`VoxelScope.keys` 的范围校验在 `resolveScope`，导入校验在 codec）：本模块不对传入键逐键重做范围校验，也不做跨对象判断。
- `keys` 为物化数组：去重、按 `VoxelKey` 升序。
- 【暂不实现】`warnings`：稳定 code 列表的触发条件与 code 集合都未定义，挂起期间 `SelectionResolution` 不携带该字段，不实现、不测试；解除时必须同时为每个 code 写明触发条件。
- 【暂不实现】`anchor?`、`truncated?`：`anchor` 的选择锚点来源与 `truncated` 的候选上限策略都未定义，挂起期间不实现、不测试，`SelectionResolution` 也不携带这两个字段；`excludedHidden` 随可见性一并挂起。
- 【暂不实现】Island：输入种子键、连通性、`includeHidden`。默认使用可见 6 邻域；`Add Connected` 使用 26 邻域。种子不存在或隐藏时返回空集合。
- 【暂不实现】Visible：返回当前所有可见键；不得依赖 render-target 可见表面，隐藏与视锥外体素仍属于 Visible 选择。
- 所有策略返回去重、稳定排序的稳定键。策略不修改 Selection/TransformSession，不生成 Patch；写入选择由 TransformCommandHandler 完成。
- XFORM Add 模式需过滤 session 内已选 entry 和重复 working position；Subtract 模式只保留当前 session 成员。该过滤属于 XFORM 命令规则，不属于通用选择策略。
- 非活动对象不得进入候选、表面键求交或连通遍历；Rectangle 的投影候选必须来自活动对象。

**依赖**：types、query、util/packed-int。岛屿策略所需的 `util/math`（pivot/几何换算）随 Island 一并挂起，本阶段不 import。
