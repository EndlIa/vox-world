# symmetry.ts

**职责**：定义单个活动 `VoxObject` 内绘制对称、体素 XFORM 镜像、旋转、半区删除和 pivot 解析的纯规则；输出键始终是该对象的局部整数坐标。

**接口**：
- `configure({ axis: "none" | "x" | "y" | "z"; pivotMode: "bounds" | "world" })`。
- `SymmetrySnapshot`：`{ axis: "none" | "x" | "y" | "z"; pivotMode: "bounds" | "world" }`；命令只保存该快照，不保存可调用方法。
- `PivotContext`：`{ pivotMode: "bounds" | "world"; inverseObjectWorldTransform?: Mat4 }`。
- `getPivot(readViewOrEntries, context)`、`mapPoint`、`mapKey`、`expand`、`validate`。
- `symmetrize(snapshot, side, pivot)`、`mirror(snapshot, pivot)`、`rotate(snapshot, direction, pivot)`、`deleteHalf(snapshot, side, pivot)`。
- `mapEntry(entry, operation)`：返回新的 workingPosition，不修改 entry。

**内部**：
- 所有模型级对称操作都以一个明确的 `VoxObjectId` 和其局部快照为上下文；不得跨对象共享 pivot 或把不同对象的局部键合并。
- axis 为 `none` 时所有展开只返回原位置；模型级 Symmetrize/Mirror/Rotate/Delete Half 必须拒绝并返回 `symmetry-axis-required`。
- 交互快捷键 `S` 按 `none → x → y → z → none` 循环，`X`、`Y`、`Z` 直接设置对应轴；快捷键只改变 `SymmetrySnapshot`，不生成 Patch、不写 History，并在一次指针手势开始时冻结到下一次手势。
- Bounds pivot：活动对象局部占用包围盒中心的算术中点，坐标为 `(min + max) / 2`，允许半整数。
- World pivot：场景世界坐标中的固定原点 `(-0.5, -0.5, -0.5)`，由调用方用对象绑定 `SceneNode` 的逆世界变换解析为该对象的局部连续坐标；不得把该点误当成对象局部原点。逆变换必须显式注入，领域函数不读取 SceneDocument。
- 镜像坐标公式为 `m = round(2 * pivot - p)`。整数 pivot 与偶数宽度按同一规则处理；奇偶尺寸不得额外加偏移。展开结果按 VoxelKey 去重。
- 绘制对称：Add 同时加入原位置与镜像位置；Remove/Paint 只在镜像目标已存在时加入，不能凭空创建镜像体素。
- `side = +1` 表示保留负侧/中线并镜像到正侧；`side = -1` 表示保留正侧/中线并镜像到负侧。位于中线的体素（到 pivot 的有符号距离绝对值不超过 `0.5`）保留且不重复创建。
- Mirror：对全模型或 XFORM entries 原地镜像。目标冲突按“后写入目标覆盖”去重，结果颜色/可见性来自被镜像源；不能产生重复键。
- Rotate：只支持绕当前轴顺时针/逆时针 90 度。Bounds pivot 使用选择/模型包围盒旋转并保持最小角锚定；World pivot 使用已解析到对象局部坐标的场景世界 pivot，最终结果四舍五入到局部整数键。XFORM 只修改 workingPosition，不写文档。
- Delete Half：只删除指定半区，中线保留；不改变 pivot 和 axis。XFORM 中仅删除当前 session 条目，模型级操作生成 Remove Patch。
- Symmetrize 先保留指定半区，再镜像保留部分；不改变颜色和可见性。操作前后对键去重，返回单次可逆 Patch 所需的数据。
- `SymmetrySnapshot` 只保存模式，不保存 SceneDocument 引用或矩阵。Handler/Session 在命令或手势开始时把 world pivot 解析为局部 pivot 并冻结；领域函数不访问 UI、SceneDocument 或 Three.js。

**依赖**：scene-types、voxel-types、voxel-query、util/math、util/packed-int、util/result。
