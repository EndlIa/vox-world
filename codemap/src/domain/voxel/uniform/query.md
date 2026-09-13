# query.ts

**职责**：提供单个 `SceneObject` 内部编辑、选择、连通性、内部体素判断和测量所需的只读体素查询。

**接口**：
- 标量 / 存在性：`bounds(snapshot) -> Bounds3i`（空容器返回 `EMPTY_BOUNDS3I`）、`count(snapshot) -> number`、`has(snapshot, key) -> boolean`、`indexOfKey(snapshot, key) -> number`（`-1` 表示不存在）、`colorAt(snapshot, key) -> ColorHex | undefined`。
- 集合（懒序列：升序、唯一、可重复遍历）：`keys(snapshot)`、`withinBox(snapshot, bounds: Bounds3i)`、`byColor(snapshot, color: ColorHex)`。
- `uniqueColors(snapshot) -> readonly ColorHex[]`：直接返回 `snapshot.palette`，零分配。
- `resolveScope(snapshot, scope: VoxelScope) -> Iterable<VoxelKey>`：`VoxelScope` 的唯一解析入口。
- `voxelAt(snapshot, index) -> VoxelSnapshot`：冷路径记录视图，`index` 来自 `indexOfKey`。
- `visibleKeys`【暂不实现】。
- `neighbors(key, neighborhood: Neighborhood)`、`isInternal(key, neighborhood: Neighborhood)`【暂不实现】：依赖 `Neighborhood`。
- `connectedComponent(seed, connectivity: Connectivity, options)`、`components(connectivity: Connectivity, options)`【暂不实现】：依赖 `Connectivity`。
- `visibleGroup()`、`hiddenGroup()`【暂不实现】。
- `measure(scope: VoxelScope)`【暂不实现】：返回体素数、占用包围盒、尺寸、包围盒体积和占用率。

**内部**：
- 所有查询都以一个对象的局部 `UniformVoxSnapshot` 为输入；输入快照属于明确的 `SceneObjectId`，不得把一个对象的查询结果与另一个对象的键混用。
- 标量查询必须二分：容器按 (x,y,z) 字典序升序且无重复，`has`/`indexOfKey`/`colorAt` 以 `VoxelKey` 逐轴比较做 O(log n) 查找，不得为单点查询遍历或复制整个容器。
- 集合查询返回懒序列：升序、唯一、**可重复遍历**（同一个返回值多次 `for...of` 结果一致）；不提供 `length`，需要计数用 `count` 或 `measure`。不得返回内部 `Map`/`Set`、可变数组或一次性生成器。
- 物化由调用方决定：选择策略、Patch 构造等需要数组时自行 `Array.from`，物化只发生一次并发生在它们自己的边界。
- 本阶段没有空间索引：`keys`/`withinBox`/`byColor`/`resolveScope` 只线性遍历容器，不复制全部体素；后续引入索引时不得改变公开签名。
- `bounds` 返回该对象的局部 `Bounds3i`；`withinBox` 接收 `Bounds3i`；`count` 等于容器字段。
- `resolveScope` 是 `VoxelScope` 的唯一解析入口，命令 Handler、选择策略与测量共用，不得各自重写 switch：`keys` 变体先按 `VoxelKey` 升序去重后迭代，且每个键必须是该对象的局部键并在 `MIN_COORDINATE..MAX_COORDINATE` 内（越界或跨对象键拒绝）；`bounds` → `withinBox`；`color` → `byColor`；`all` → `keys`；`visible`/`hidden`/`slice-y`【暂不实现】。
- 单键记录读取用 `indexOfKey` + `voxelAt`；本模块不提供在热路径分配记录对象的 `get`。
- 【暂不实现】`connectivity = 6` 使用六个轴向邻居；`26` 使用六轴加 20 个边/角方向。连通遍历默认只穿过 `visible === true` 的体素，隐藏体素阻断连通；Group by Islands 和 Bucket Island 共用该规则。
- 【暂不实现】`isInternal` 的 neighborhood 只允许 6/18/26。当前体素在对应邻域内所有邻居都存在时为内部体素；隐藏体素仍算占用。不能把“不可见”误判为空。6 使用轴向、18 使用轴向与边方向、26 再加角方向。
- `byColor` 使用规范化颜色的精确相等语义：先在该对象的 `palette` 中二分定位（palette 已按颜色字典序升序），再按 `colorIndex` 扫描；`color` 参数一律 `ColorHex`，不接受 `colorIndex`。颜色组不是单独实体，同一颜色的所有体素构成一个逻辑组，即使它们属于多个岛屿；本模块不提供与 `byColor` 重复的 `colorGroup`。
- `uniqueColors` 直接返回 `snapshot.palette`，不得重建数组或重新排序。
- 【暂不实现】`connectedComponent` 返回稳定排序的键；种子不存在、种子隐藏或空图时返回空集合。`components` 返回各分量稳定排序后的数组，排序键为最小 `VoxelKey`。连通分量只接受 6/26；18 仅用于 `isInternal` 的邻域判断。
- 【暂不实现】`measure` 的体素数来自 scope；尺寸为占用包围盒边长，盒体积为三边相乘，占用率为 `count / boxVolume`。空集合返回零值，不抛异常。
- 查询不接受 renderer/pick 结果；屏幕可见表面集合由 PickService 提供，再由 Handler 与活动对象查询结果求交。
- Edit 模式下调用方必须先通过 `EditorState.activeSceneObjectId` 取得该对象的局部 `UniformVoxSnapshot`；查询模块不负责判断哪个对象可编辑。

**依赖**：types、util/color、util/packed-int。

## 本重构必须补齐

- 必须实现标量查询 `bounds`/`count`/`has`/`indexOfKey`/`colorAt`（二分，不得全量扫描）、懒序列 `keys`/`withinBox`/`byColor`、`uniqueColors`、`resolveScope` 与 `voxelAt`，覆盖本阶段 Box / Rectangle / Color 三类选择与 `VoxelScope` 的四个本阶段变体。
- 懒序列必须可重复遍历且两次结果一致，输出升序、唯一；跨对象键与越界键必须拒绝。
- `byColor` 必须先经 `palette` 定位颜色，再按 `colorIndex` 扫描。
- 【暂不实现】Island、Visible 两类选择所需的只读查询，以及可见组、隐藏组、`visibleKeys`。
- 【暂不实现】`isInternal` 的 6/18/26 邻域；隐藏体素仍视为占用的规则随可见性一并挂起。
- 【暂不实现】`connectedComponent`/`components` 的 6/26 连通遍历与稳定排序；Group by Islands 与 Bucket Island 的共用规则随连通性一并挂起。
- 【暂不实现】`measure` 必须返回体素数、占用包围盒、尺寸、盒体积和占用率，空集合返回零值。
