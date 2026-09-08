# voxel-query.ts

**职责**：提供编辑、选择、连通性、内部体素判断和测量所需的只读体素查询。

**接口**：
- `has`、`get`、`keys`、`visibleKeys`、`bounds`、`withinBox`、`byColor`、`uniqueColors`。
- `neighbors(key, connectivity)`、`isInternal(key, neighborhood: 6 | 18 | 26)`。
- `connectedComponent(seed, connectivity, options)`、`components(connectivity, options)`。
- `colorGroup(color)`、`visibleGroup()`、`hiddenGroup()`。
- `measure(scope)`：返回体素数、占用包围盒、尺寸、包围盒体积和占用率。

**内部**：
- 优先使用空间索引按范围查询，退化时遍历只读视图；不复制全部体素，除非调用方明确要求快照。
- `connectivity = 6` 使用六个轴向邻居；`26` 使用六轴加 20 个边/角方向。连通遍历默认只穿过 `visible === true` 的体素，隐藏体素阻断连通；Group by Islands 和 Bucket Island 共用该规则。
- `isInternal` 的 neighborhood 只允许 6/18/26。当前体素在对应邻域内所有邻居都存在时为内部体素；隐藏体素仍算占用。不能把“不可见”误判为空。6 使用轴向、18 使用轴向与边方向、26 再加角方向。
- `byColor` 使用规范化颜色的精确相等语义。颜色组不是单独实体；同一颜色的所有体素构成一个逻辑组，即使它们属于多个岛屿。
- `connectedComponent` 返回稳定排序的键；种子不存在、种子隐藏或空图时返回空集合。`components` 返回各分量稳定排序后的数组，排序键为最小 `VoxelKey`。连通分量只接受 6/26；18 仅用于 `isInternal` 的邻域判断。
- `measure` 的体素数来自 scope；尺寸为占用包围盒边长，盒体积为三边相乘，占用率为 `count / boxVolume`。空集合返回零值，不抛异常。
- 查询不接受 renderer/pick 结果；屏幕可见表面集合由 PickService 提供，再由 Handler 与查询结果求交。

**依赖**：voxel-types、util/octree、util/packed-int。

## 本重构必须补齐

- 必须实现 Box、Rectangle、Color、Island、Visible 五类选择所需的只读查询，以及颜色组、可见组和隐藏组。
- `isInternal` 必须完整支持 6/18/26 邻域；隐藏体素仍视为占用，不能把不可见误判为空。
- `connectedComponent`/`components` 必须实现 6/26 连通遍历和稳定排序，Group by Islands 与 Bucket Island 共用同一规则。
- `measure` 必须返回体素数、占用包围盒、尺寸、盒体积和占用率，空集合返回零值。
