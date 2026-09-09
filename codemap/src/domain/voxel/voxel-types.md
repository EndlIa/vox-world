# voxel-types.ts

**职责**：定义单个 `VoxObject` 内部的位置、颜色、可见性、选择范围和算法请求共享的纯数据契约。

**接口**：
- `VoxelKey`、`GridPosition`（三个安全整数）、`Bounds3i`（闭区间）、`BoxSpec`、`ScreenRect`、`VoxelColor`。
- `VoxelValue`：`{ position: GridPosition; color: VoxelColor; visible: boolean }`。
- `VoxelSnapshot`、`VoxelReadView`、`VoxelEntrySnapshot`、`ColorHex`、`Neighborhood = 6 | 18 | 26`、`Connectivity = 6 | 26`。
- `CommandScope`：`keys | color | bounds | all | visible | hidden | slice-y` 的可辨识联合；禁止携带谓词函数。

**内部**：
- `VoxelKey` 与 `ColorHex` 的唯一 owner 分别是 `util/packed-int`、`util/color`；本模块只可显式 re-export，不得重新声明同形类型。`VoxelColor` 是领域别名 `ColorHex`。
- `GridPosition`、`Bounds3i` 的唯一 owner 是本模块；不得别名到 `util/math` 的 `Vec3`、`Aabb`，两者分别表达整数体素坐标/闭区间和通用浮点数学值。
- `VoxelKey` 是 `VoxObject` 的局部网格键，不在场景级唯一。跨对象引用必须使用 `scene-types` 的 `ObjectVoxelRef`。
- 坐标必须是安全整数；所有范围均为闭区间。空范围用 `isEmpty` 表示，不把 `Infinity` 写入持久化数据。
- 颜色在进入领域层时规范化为大写 `#RRGGBB`；颜色比较按规范化字符串精确比较。颜色同时承担“颜色组/层”的身份，不另建持久化 Group ID。
- `visible` 只控制编辑与渲染可见性，不删除体素；隐藏体素仍属于文档、包围盒和优化邻域判断。
- `VoxelReadView` 只暴露 `get/has/keys/visibleKeys/bounds/byColor` 等只读操作，不暴露 Map、数组或可变对象。
- 快照只含普通可序列化数据，可直接结构化克隆给 Worker；禁止 Three.js、DOM、类实例、函数和命令上下文。
- 位置相同视为同一稳定体素；Patch、选择、XFORM 和 Worker 结果统一按 `VoxelKey` 去重。
- `Neighborhood` 用于内部体素判断，必须支持 6、18、26；`Connectivity` 用于岛屿/连通分量，只允许 6（面邻接）或 26（面、边、角邻接）。两者不能混用同一个默认值。
- 快照输出必须按该对象的局部 `VoxelKey` 稳定排序；空快照和空范围合法，不使用 `Infinity`、`NaN` 或函数值。
- 所有查询、补丁、选择和算法函数都必须显式绑定一个 `VoxObject` 上下文；没有对象上下文的裸体素操作不得进入场景层。

**依赖**：util/color、util/packed-int、util/math。
