# object-selection-strategies.ts

**职责**：定义 Object 模式下对 `VoxObject` 的纯候选解析规则。

**接口**：
- `ObjectSelectionStrategy` 可辨识联合：`pick`、`outliner`。第一版不定义多选或 Select All。
- `resolveObjectSelection(strategy, scene, input) -> ObjectSelectionResolution`。
- `ObjectSelectionResolution`：`objectId: VoxObjectId | null`、`warnings`。

**内部**：
- `pick` 只接受 PickService 返回的稳定 `VoxObjectId`，不接收 Three.js 对象或节点实例。
- `outliner` 按场景节点树顺序解析明确给出的对象 ID；不得依赖数组索引。
- 解析结果最多一个对象。指向组节点、根节点或不存在的 ID 时返回 `null` 和 warning，不能隐式选择其子对象。
- 两种策略都允许 outliner 显式选择隐藏对象；屏幕 `pick` 必须尊重渲染可见性。
- 对象选择不读取或修改对象内部体素，不改变 `EditorState`、Selection、XFORM 或 SceneDocument；写入状态由命令 Handler 完成。
- Object 模式不产生体素键。Edit 模式不得使用本模块；它必须使用活动对象的体素选择策略。

**依赖**：scene-types、scene-query、util/result。
