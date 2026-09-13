# types.ts

**职责**：定义单个 `SceneObject` 内部的位置、颜色、可见性、选择范围和算法请求共享的纯数据契约。

**接口**：
- `VoxelKey`、`GridPosition`（三个整数，每轴 `MIN_COORDINATE..MAX_COORDINATE`）。
- `Bounds3i`：`{ isEmpty: true } | { isEmpty: false; min: GridPosition; max: GridPosition }`；非空为闭区间整数范围，空状态独占、不携带 `min`/`max`。
- `BoxSpec`【暂不实现】：本阶段不定义其形状，任何实现与上层契约不得引用该名字。
- `UniformVoxSnapshot`、`VoxelSnapshot`、`ColorHex`、`PALETTE_LIMIT`。
- `UniformVoxParts`：`uniformVoxSnapshot` 的未排序输入列（见类型形状）。产出入口 `gridPosition`、`gridPositionFromKey`、`gridPositionFromSnapshot`、`bounds3i`、`uniformVoxSnapshot` 与常量 `EMPTY_BOUNDS3I` 属于本模块；冷路径记录读取 `voxelAt`、`voxelRecords` 由 `query.ts` 提供，本模块不重复声明。
- `Neighborhood = 6 | 18 | 26`、`Connectivity = 6 | 26`【暂不实现】：本阶段不实现邻域与连通性参数。
- `VoxelScope`：体素寻址的唯一 owner，`kind` 判别的可辨识联合（载荷见类型形状）。变体 `visible`、`hidden`、`slice-y`【暂不实现】（三者都依赖可见性语义）。

**类型形状**：

```ts
export const PALETTE_LIMIT = 256;

export type GridPosition = Readonly<{
  x: number;
  y: number;
  z: number;
}> & {
  readonly __brand: "GridPosition";
};

// 热路径容器：SoA + typed array（7 B/体素）
export type UniformVoxSnapshot = Readonly<{
  count: number;
  x: Int16Array;                 // 2 B/体素
  y: Int16Array;                 // 2 B/体素
  z: Int16Array;                 // 2 B/体素
  colorIndex: Uint8Array;        // 1 B/体素，palette 下标
  palette: readonly ColorHex[];  // <= PALETTE_LIMIT，索引即颜色组身份
}>;

// 冷路径记录视图：只在 codec / 命令 / patch / 测试中使用
export type VoxelSnapshot = Readonly<{
  position: GridPosition;
  color: ColorHex;
}>;

// 体素寻址的唯一语言：可序列化、无谓词、无运行时状态引用
export type VoxelScope =
  | Readonly<{ kind: "keys"; keys: readonly VoxelKey[] }>
  | Readonly<{ kind: "color"; color: ColorHex }>
  | Readonly<{ kind: "bounds"; bounds: Bounds3i }>
  | Readonly<{ kind: "all" }>;
// 挂起变体【暂不实现】：{ kind: "visible" } | { kind: "hidden" } | { kind: "slice-y"; sliceY }

// uniformVoxSnapshot 的输入列：同一下标的四个数值 + palette 索引描述一个体素
export type UniformVoxParts = Readonly<{
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
  colorIndex: ArrayLike<number>;
  palette: readonly ColorHex[];
}>;

export type GridPositionError = Readonly<{
  code: "invalid-coordinate";
  axis: "x" | "y" | "z";
}>;

export type Bounds3iError = Readonly<{
  code: "invalid-bounds";
  axis: "x" | "y" | "z";
}>;

export type UniformVoxSnapshotError =
  | GridPositionError
  | Readonly<{
      code: "invalid-column-length";
      column: "y" | "z" | "colorIndex";
    }>
  | Readonly<{ code: "invalid-color-index"; index: number }>
  | Readonly<{ code: "palette-limit-exceeded"; limit: number }>;
```

`Bounds3i` 的形状见上（`isEmpty` 独占联合、字段为 `GridPosition`），因此不需要再品牌化：`GridPosition` 的 brand 已足以让 `Aabb` 无法赋给 `Bounds3i`。

**内部**：
- `VoxelKey` 与 `ColorHex` 的唯一 owner 分别是 `util/packed-int`、`util/color`；本模块只可显式 re-export，不得重新声明同形类型，也不得为它们另起领域别名：域内颜色一律写作 `ColorHex`。
- `GridPosition`、`Bounds3i` 的唯一 owner 是本模块；不得别名到 `util/math` 的 `Vec3`、`Aabb`，两者分别表达整数体素坐标/闭区间和通用浮点数学值。
- 对象局部范围与世界空间 `Aabb` 的互转只发生在显式转换函数中（`scene-query.worldBounds` 把局部 `Bounds3i` 转为世界 `Aabb`）；领域函数不隐式混用两者。
- `VoxelKey` 是 `SceneObject` 的局部网格键，不在场景级唯一。跨对象引用必须显式携带目标对象的 `SceneObjectId` 与该对象的局部 `VoxelKey`。
- 坐标范围采用 `util/packed-int` 的权威范围：每轴必须是 `MIN_COORDINATE..MAX_COORDINATE`（−32768..32767）内的整数。越界值必须在进入领域数据前被拒绝（`pack` 返回 `coordinate_out_of_range`，导入与命令校验按同一范围拒绝），不得 clamp、截断或静默丢弃；所有范围均为闭区间。空范围用 `isEmpty` 表示，不把 `Infinity` 写入持久化数据。
- `GridPosition` 只由三个入口产出：公开校验入口 `gridPosition(x, y, z): Result<GridPosition, GridPositionError>`（三个有限整数且每轴在 `MIN_COORDINATE..MAX_COORDINATE` 内，否则返回错误；多轴非法时按 x → y → z 报告首个）、已证明通道 `gridPositionFromKey(key: VoxelKey): GridPosition`，以及容器专用已证明通道 `gridPositionFromSnapshot(snapshot, index): GridPosition`（`index` 来自 `count` 内，坐标已由构造器校验）。`gridPositionFromKey` 只允许在坐标范围已由 `pack`/`unpack` 或按 16-bit 范围校验过的解码流程证明的位置使用，允许场景仅限：`util/packed-int.unpack` 的派生、`voxel-codec` 的解析、Worker 结果转 Patch；其他位置必须走 `gridPosition`，不得用它绕过校验。品牌断言只存在于本模块内部（这两个已证明通道共用同一个私有构造点），`query` 等下游模块不得自行断言，只能调用这三个入口之一。
- `Bounds3i` 只由 `bounds3i(min, max): Result<Bounds3i, Bounds3iError>`（逐轴要求 `min <= max`，否则返回错误；`min`/`max` 已是 `GridPosition`，无需重复范围校验）与常量 `EMPTY_BOUNDS3I`（即 `{ isEmpty: true }`）产出。由现存 `GridPosition` 极值派生紧包围盒时（`query.bounds`、Fill Holes 的紧盒），`min <= max` 由构造过程保证，允许在模块内直接构造。
- `GridPositionError`、`Bounds3iError` 是普通可序列化错误数据（分别含失败 `axis` 与稳定 `code`，即 `"invalid-coordinate"`、`"invalid-bounds"`），可跨 Worker/持久化边界；不得携带 `NaN`、`Infinity` 等不可序列化值，因此坐标错误只记录失败 `axis`，不回传原始值。
- `UniformVoxSnapshotError` 复用 `GridPositionError` 并追加 `"invalid-column-length"`（携带首个不符的 `column`，参照列为 `x`）、`"invalid-color-index"`（携带出错条目的输入下标 `index`）与 `"palette-limit-exceeded"`（携带 `limit`）；同样只含普通可序列化数据。
- 类型隔离不靠文档约定：`Vec3` 不能赋给 `GridPosition`（brand），`Aabb` 不能赋给 `Bounds3i`（字段品牌）；反方向 `GridPosition → Vec3`、`Bounds3i → Aabb` 允许，用于把领域整数围盒当通用数学值读取。
- 类型级断言与产出者测试放在 `test/domain/voxel/uniform/types.test.ts`：`expectTypeOf<Vec3>().not.toExtend<GridPosition>()`、`expectTypeOf<Aabb>().not.toExtend<Bounds3i>()`；`GridPosition`、`Bounds3i` 保持 `readonly` 形状（对可变形状做负断言）；`gridPosition` 拒绝非整数、非有限值与越界坐标，`bounds3i` 拒绝 `min > max`，`gridPositionFromKey` 与 `gridPosition` 对同一键给出的 position 逐分量一致；构造器接收未排序输入后产出 canonical 容器、重复位置按最后出现者覆盖、palette 超限返回 `palette-limit-exceeded`、无重复输入下同一体素集合产出相同容器、且不修改任何入参。
- `VoxelScope` 是**体素寻址的唯一 owner**：命令族、查询与算法不再各自声明“哪些体素”的联合（原 `voxel-commands.VisibilityTarget` 等必须收敛到本类型）。判别字段固定为 `kind`，载荷见类型形状。
- `VoxelScope` 只表达**已可寻址**的集合：`keys` 为去重后的局部键、`color` 为该对象内同色体素、`bounds` 为闭区间内的现存体素、`all` 为全部体素。禁止谓词函数、回调、DOM/Three.js 对象与运行时状态引用；“当前选择”这类运行时集合由上层解析后以 `{ kind: "keys" }` 传入。
- 交互获取方式（屏幕矩形候选、Bridge 路径生成、Bucket 岛屿种子、坐标输入等）不是 scope 变体：它们是需要上层解析的输入，解析结果必须表述为 `VoxelScope`。`keys` 必须是该对象的局部键，跨对象键由上层禁止。
- 颜色在进入领域层时规范化为大写 `#RRGGBB`；颜色比较按规范化字符串精确比较。颜色同时承担“颜色组/层”的身份，不另建持久化 Group ID。
- `visible` 只控制编辑与渲染可见性，不删除体素；隐藏体素仍属于文档、包围盒和优化邻域判断。**【暂不实现】**本条整体挂起：本阶段不实现可见性，单条体素记录 `VoxelSnapshot` 不携带 `visible`。
- 本模块不声明读取门面类型：只读查询统一由 `query.ts` 基于对象的局部 `UniformVoxSnapshot` 提供；任何层都不得暴露所有权状态的内部 `Map`/`Set` 或可变对象（快照容器是公开只读数据，不属于内部状态）。
- `UniformVoxSnapshot` 是 SoA 容器：`x/y/z` 按 `VoxelKey` 升序（打包布局 x 高位，数值序等于 (x,y,z) 字典序）、无重复位置、`count` 与全部数组长度一致、`colorIndex[i] < palette.length`。这些不变量由构造器建立，消费者不再重复校验。
- `palette` 按规范化颜色字符串字典序升序，构造期把 `colorIndex` 重映射到新下标，因此对不含重复位置的输入，**同一体素集合只有一个容器表示**（canonical form，供测试、持久化 diff 与确定性 golden 使用）；含重复位置时由下一条的覆盖规则按输入顺序确定性地归一。`palette` 只包含被现存体素引用的颜色：输入中重复或未被引用的条目在规范化时合并/丢弃，因此上限 `PALETTE_LIMIT = 256` 按规范化后的 palette 大小判定，超限返回显式错误 `palette-limit-exceeded`，不得合并颜色、就近取色或截断。`colorIndex` 就是颜色组/层身份，不另建 Group ID。颜色在**任何 API 边界**一律写作 `ColorHex`；`colorIndex` 只是容器内部表示，不得出现在 public 签名里（`query.byColor` 的参数、`VoxelScope` 的 `color` 变体载荷等一律用 `ColorHex`）。
- 构造入口 `uniformVoxSnapshot(parts): Result<UniformVoxSnapshot, UniformVoxSnapshotError>`：`parts` 是 `UniformVoxParts` 的四条 `ArrayLike<number>` 列（`x`/`y`/`z`/`colorIndex`）加 `palette`，同一下标描述一个体素；列可以是普通数组或 typed array（`UniformVoxSnapshot` 本身也是合法输入，重新构造保持 canonical）。先校验 `y`/`z`/`colorIndex` 与 `x` 等长，再按输入顺序逐条校验：坐标经 `pack` 判定（包括非整数与非有限值，多轴非法按 x → y → z 报告首个），随后要求 `palette[colorIndex]` 存在（`colorIndex` 非整数、越界或 `palette` 缺失该下标都归为 `invalid-color-index`）。接受未排序输入，完成排序、去重与 palette 规范化；**重复位置按“后写入者覆盖”收敛**：同一位置只保留最后出现的那条记录（与 `patch` 的“Paint 保留最后一次值”同款，结果由输入顺序确定性决定）。这与持久化格式是两个边界：`voxel-codec` 仍把文本记录里的重复坐标判为 `DUPLICATE_VOXEL_KEY` 格式错误，不采用覆盖。
- 冷路径通过 `query.ts` 的 `voxelAt(snapshot, index): VoxelSnapshot` 与 `voxelRecords(snapshot)` 读取单条记录；热路径（渲染实例缓冲、网格 Worker、导出）直接读容器字段，不构造记录对象。`VoxelSnapshot` 只作为冷路径视图存在，不是存储形态；本模块只定义该形状，不重复提供读取入口。
- 容器不可变是**约定**而非编译期保证：`Readonly<{...}>` 只挡属性重赋值，挡不住 `x[i] = …`，typed array 也无法 `Object.freeze`。写入只允许所有者通过构造器产出**新容器**；任何函数不得修改传入容器。纯函数（如 `patch.apply`）可以通过 `uniformVoxSnapshot` 产出新容器，但其结果只有在所有者采纳为当前值后才成为文档状态——非所有者产出容器不构成对文档的写入。
- 品牌只在 API 边界：容器内部是裸数值。从容器坐标取 `GridPosition` 属于已证明场景（已按范围校验），加入上面 `gridPositionFromKey` 的允许列表；`ColorHex` 直接来自 `palette` 元素，无需转换。
- 快照容器只含可结构化克隆的普通数据（含 typed array），可直接复制给 Worker；跨 Worker 派发允许 transfer，**转移即所有权移交**：发送方 buffer 被 detach，转移后不得再读取该容器。禁止 Three.js、DOM、类实例、函数和命令上下文。
- 位置相同视为同一稳定体素；Patch、选择、XFORM 和 Worker 结果统一按 `VoxelKey` 去重。
- `Neighborhood` 用于内部体素判断，必须支持 6、18、26；`Connectivity` 用于岛屿/连通分量，只允许 6（面邻接）或 26（面、边、角邻接）。两者不能混用同一个默认值。**【暂不实现】**：本阶段不实现邻域/连通性及其消费方。
- 快照输出必须按该对象的局部 `VoxelKey` 稳定排序；空快照和空范围合法，不使用 `Infinity`、`NaN` 或函数值。
- 底层查询、补丁、选择和算法函数只操作单个对象的本地数据（局部 `UniformVoxSnapshot` 与局部 `VoxelKey`），不强制携带对象身份；对象身份的解析与上下文绑定由上层命令与 `ScenePatch` 层完成，裸体素数据不得绕过该绑定直接进入场景层。

**依赖**：util/color、util/packed-int、util/result。与 `util/math` 的 `Vec3`/`Aabb` 只在结构上兼容（`GridPosition → Vec3`、`Bounds3i → Aabb` 可赋值），本模块不 import `util/math`。

## 暂不实现（当前阶段）

标记 **【暂不实现】** 的类型、字段、变体与条款仍属于目标状态，但本阶段不实现、不测试，任何实现与上层契约不得依赖它们；解除标记必须先取得用户同意（标记规则见 `codemap/README.md`）。

- `BoxSpec`：形状未定且无消费方；Add `box` intent 与 `BoxGeneratorSpec` 继续各自内联形状，不引入 `BoxSpec`。
- `Neighborhood`、`Connectivity`：连带挂起 `query.neighbors`、`query.isInternal`、`query.connectedComponent`、`query.components` 及其消费方（Island 选择、Group by Islands、Bucket Island）。
- `VoxelSnapshot.visible`（单条体素记录）：连带挂起 `query.visibleKeys`、`query.visibleGroup`/`hiddenGroup`、`VoxelScope` 的 `{ kind: "visible" }`/`{ kind: "hidden" }`/`{ kind: "slice-y" }` 变体、`patch` 的 `setVisibility` 操作，以及 `voxel-commands` 的可见性命令族（`SetVisibilityCommand`、`InvertVisibilityCommand`、`DeleteHiddenCommand`）与 `GroupByIslandsCommand`。
- 本文件不涉及 `scene-types` 的节点级 `SceneNodeSnapshot.visible`：那是渲染子树开关，与体素可见性是两个独立概念。
- 挂起不等于删除：解除时必须同步修改实现、测试与所有上层契约。
