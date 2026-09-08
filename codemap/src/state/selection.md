# selection.ts

**职责**：持有当前选择集的稳定键、选择来源、选择模式和锚点，不持有变换预览或体素副本。

**接口**：
- `SelectionState`：`keys: ReadonlySet<VoxelKey>`、`mode: "replace" | "add" | "subtract"`、`anchor?: VoxelKey`、`source: "box" | "rectangle" | "color" | "island" | "visible" | "xform"`、`version`。
- `set`、`replace`、`add`、`remove`、`toggle`、`clear`、`contains`、`snapshot`、`subscribe`。
- `snapshot()` 返回冻结的 `SelectionSnapshot`，包含有序键和锚点；不得泄漏可变 Set。

**内部**：
- 只保存稳定体素键，不保存 `VoxelValue` 对象、Transform entry 或渲染对象；颜色、位置和可见性在需要时通过 `VoxelReadView` 读取。
- `replace` 用于新选择手势，`add/subtract` 用于 XFORM 的 Add/Subtract 模式。同一键幂等；结果按稳定键排序，保证快照和历史可复现。
- Box、Rectangle、Color、Island、Visible 选择由命令 Handler 计算候选后写入；Selection 本身不遍历体素、不计算连通分量、不解析 working position。
- XFORM 会话拥有独立 entry 列表；Selection 只保存需要跨命令表达的键，不能把 working entry 当作已提交体素。
- 选择变更不修改 `VoxelDocument`、不写 History、不触发渲染提交。`version` 每次有效集合变化递增，供 UI 和预览缓存失效。
- 空选择合法。清除选择不隐式提交或取消 XFORM。

**依赖**：voxel-types、util/packed-int。

## 本重构必须补齐

- 必须支持 `replace`、`add`、`subtract` 三种选择模式和 `box`、`rectangle`、`color`、`island`、`visible`、`xform` 六种来源。
- 五类选择入口必须由命令 Handler 计算候选后写入 Selection；Selection 自身不得遍历体素或计算连通性。
- 必须保存稳定键、锚点和单调递增版本，快照必须冻结且不泄漏可变 `Set`。
- XFORM 的 working entries 必须继续由 TransformSession 独占，不能混入已提交 Selection。
