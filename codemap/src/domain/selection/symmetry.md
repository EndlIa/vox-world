# symmetry.ts

**职责**：定义绘制对称、模型/XFORM 镜像、旋转、半区删除和 pivot 解析的纯整数规则。

**接口**：
- `configure({ axis: "none" | "x" | "y" | "z"; pivotMode: "bounds" | "world" })`。
- `SymmetrySnapshot`：`{ axis: "none" | "x" | "y" | "z"; pivotMode: "bounds" | "world" }`；命令只保存该快照，不保存可调用方法。
- `getPivot(readViewOrEntries)`、`mapPoint`、`mapKey`、`expand`、`validate`。
- `symmetrize(snapshot, side)`、`mirror(snapshot)`、`rotate(snapshot, direction)`、`deleteHalf(snapshot, side)`。
- `mapEntry(entry, operation)`：返回新的 workingPosition，不修改 entry。

**内部**：
- axis 为 `none` 时所有展开只返回原位置；模型级 Symmetrize/Mirror/Rotate/Delete Half 必须拒绝并返回 `symmetry-axis-required`。
- 交互快捷键 `S` 按 `none → x → y → z → none` 循环，`X`、`Y`、`Z` 直接设置对应轴；快捷键只改变 `SymmetrySnapshot`，不生成 Patch、不写 History，并在一次指针手势开始时冻结到下一次手势。
- Bounds pivot：占用包围盒中心的算术中点，坐标为 `(min + max) / 2`，允许半整数；世界 pivot 固定为 `(-0.5, -0.5, -0.5)`，与体素中心/原点语义一致。
- 镜像坐标公式为 `m = round(2 * pivot - p)`。整数 pivot 与偶数宽度按同一规则处理；奇偶尺寸不得额外加偏移。展开结果按 VoxelKey 去重。
- 绘制对称：Add 同时加入原位置与镜像位置；Remove/Paint 只在镜像目标已存在时加入，不能凭空创建镜像体素。
- `side = +1` 表示保留负侧/中线并镜像到正侧；`side = -1` 表示保留正侧/中线并镜像到负侧。位于中线的体素（到 pivot 的有符号距离绝对值不超过 `0.5`）保留且不重复创建。
- Mirror：对全模型或 XFORM entries 原地镜像。目标冲突按“后写入目标覆盖”去重，结果颜色/可见性来自被镜像源；不能产生重复键。
- Rotate：只支持绕当前轴顺时针/逆时针 90 度。Bounds pivot 使用选择/模型包围盒旋转并保持最小角锚定；World pivot 使用世界 pivot 计算后四舍五入到整数坐标。XFORM 只修改 workingPosition，不写文档。
- Delete Half：只删除指定半区，中线保留；不改变 pivot 和 axis。XFORM 中仅删除当前 session 条目，模型级操作生成 Remove Patch。
- Symmetrize 先保留指定半区，再镜像保留部分；不改变颜色和可见性。操作前后对键去重，返回单次可逆 Patch 所需的数据。
- 对称配置不是持久化模型数据；项目只保存实际体素结果。UI 预览可读取配置，但领域函数不得访问 UI。

**依赖**：voxel-types、voxel-query、util/math、util/packed-int、util/result。
