# voxel-types.ts

**职责**：定义体素文档、位置、颜色、可见性、选择范围和算法请求共享的纯数据契约。

**接口**：
- `VoxelKey`、`GridPosition`（三个安全整数）、`Bounds3i`（闭区间）、`BoxSpec`、`ScreenRect`、`VoxelColor`。
- `VoxelValue`：`{ position: GridPosition; color: VoxelColor; visible: boolean }`。
- `VoxelSnapshot`、`VoxelReadView`、`VoxelEntrySnapshot`、`ColorHex`、`Neighborhood = 6 | 18 | 26`、`Connectivity = 6 | 26`。
- `CommandScope`：`keys | color | bounds | all | visible | hidden | slice-y` 的可辨识联合；禁止携带谓词函数。

**内部**：
- 坐标必须是安全整数；所有范围均为闭区间。空范围用 `isEmpty` 表示，不把 `Infinity` 写入持久化数据。
- 颜色在进入领域层时规范化为大写 `#RRGGBB`；颜色比较按规范化字符串精确比较。颜色同时承担“颜色组/层”的身份，不另建持久化 Group ID。
- `visible` 只控制编辑与渲染可见性，不删除体素；隐藏体素仍属于文档、包围盒和优化邻域判断。
- `VoxelReadView` 只暴露 `get/has/keys/visibleKeys/bounds/byColor` 等只读操作，不暴露 Map、数组或可变对象。
- 快照只含普通可序列化数据，可直接结构化克隆给 Worker；禁止 Three.js、DOM、类实例、函数和命令上下文。
- 位置相同视为同一稳定体素；Patch、选择、XFORM 和 Worker 结果统一按 `VoxelKey` 去重。
- `Neighborhood` 用于内部体素判断，必须支持 6、18、26；`Connectivity` 用于岛屿/连通分量，只允许 6（面邻接）或 26（面、边、角邻接）。两者不能混用同一个默认值。
- 快照输出必须按 `VoxelKey` 稳定排序；空快照和空范围合法，不使用 `Infinity`、`NaN` 或函数值。

**依赖**：util/color、util/packed-int、util/math。
