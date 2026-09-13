# scene-types.ts

**职责**：定义场景、场景节点、体素对象和对象变换的纯数据契约，并提供场景快照与节点/对象身份的唯一构造与校验入口。

**接口**：
- `SceneNodeId`、`SceneObjectId`：稳定、不透明、非空字符串身份；不得由名称、数组索引或当前坐标推导。
- `sceneNodeId(raw)`、`sceneObjectId(raw)`：身份的唯一铸造入口。
- `SceneTransform`、`SceneNodeSnapshot`、`SceneObjectSnapshot`、`SceneSnapshot`，以及对应的未校验输入 `SceneTransformInput`、`SceneNodeSnapshotInput`、`SceneObjectSnapshotInput`、`SceneSnapshotInput`。
- `sceneSnapshot(input)`：场景快照的唯一构造入口。
- `SceneValidationError`：带字面量 `code` 的可辨识联合，码值见下。

**类型形状**：

```ts
export type SceneNodeId = string & { readonly __brand: "SceneNodeId" };
export type SceneObjectId = string & { readonly __brand: "SceneObjectId" };

export type SceneTransform = Readonly<{
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}>;

// 未校验输入：rotation 是裸四元数分量，由 sceneSnapshot 校验并铸造 Quat
export type SceneTransformInput = Readonly<{
  position: Vec3;
  rotation: Readonly<{ x: number; y: number; z: number; w: number }>;
  scale: Vec3;
}>;

export type SceneNodeSnapshot = Readonly<{
  id: SceneNodeId;
  parentId: SceneNodeId | null;
  childIds: readonly SceneNodeId[];
  name: string;
  transform: SceneTransform;
  visible: boolean;
  sceneObjectId: SceneObjectId | null;
}>;

export type SceneNodeSnapshotInput = Readonly<{
  id: string;
  parentId: string | null;
  childIds: readonly string[];
  name: string;
  transform: SceneTransformInput;
  visible: boolean;
  sceneObjectId: string | null;
}>;

export type SceneObjectSnapshot = Readonly<{
  id: SceneObjectId;
  voxels: UniformVoxSnapshot;
}>;

export type SceneObjectSnapshotInput = Readonly<{
  id: string;
  voxels: UniformVoxSnapshot;
}>;

export type SceneSnapshot = Readonly<{
  rootNodeId: SceneNodeId;
  nodes: readonly SceneNodeSnapshot[];
  objects: readonly SceneObjectSnapshot[];
}>;

export type SceneSnapshotInput = Readonly<{
  rootNodeId: string;
  nodes: readonly SceneNodeSnapshotInput[];
  objects: readonly SceneObjectSnapshotInput[];
}>;

export type SceneValidationError =
  | Readonly<{ code: "empty-id" }>
  | Readonly<{ code: "duplicate-node-id"; nodeId: string }>
  | Readonly<{ code: "duplicate-object-id"; sceneObjectId: string }>
  | Readonly<{ code: "root-missing" }>
  | Readonly<{ code: "root-invalid"; nodeId: string }>
  | Readonly<{ code: "parent-missing"; nodeId: string }>
  | Readonly<{ code: "parent-not-found"; nodeId: string; parentId: string }>
  | Readonly<{ code: "child-not-found"; nodeId: string; childId: string }>
  | Readonly<{ code: "duplicate-child"; nodeId: string; childId: string }>
  | Readonly<{ code: "parent-child-mismatch"; nodeId: string; childId: string }>
  | Readonly<{ code: "cycle"; nodeId: string }>
  | Readonly<{ code: "object-not-found"; nodeId: string; sceneObjectId: string }>
  | Readonly<{ code: "object-unbound"; sceneObjectId: string }>
  | Readonly<{ code: "object-multiply-bound"; sceneObjectId: string; nodeIds: readonly string[] }>
  | Readonly<{ code: "leaf-node-has-children"; nodeId: string }>
  | Readonly<{
      code: "invalid-transform";
      nodeId: string;
      channel: "position" | "rotation" | "scale";
    }>;
```

**内部**：
- `SceneSnapshot` 是场景的纯数据快照。`nodes` 和 `objects` 使用扁平只读数组，避免递归对象、父指针环和重复所有权；节点关系通过 `parentId`/`childIds` 表达。
- `sceneSnapshot` 是 `SceneSnapshot` 的唯一构造入口，也是场景结构不变量的唯一校验点：它校验全部结构不变量、产出 canonical 形式，并铸造 `SceneNodeId`/`SceneObjectId`/`Quat` 的 brand。查询、补丁、文档和持久化解码都不得另行实现这套校验，也不得用类型断言把未校验数据当作 `SceneSnapshot`。
- 下列检查覆盖全部结构不变量，逐条如下；任一条失败立即返回对应的 `SceneValidationError`，不做部分修复，也不返回部分结果。**多个检查同时失败时报告哪一个错误码未定义**：错误码之间的先后顺序不是契约，实现也不承诺 `SceneValidationError` 联合的成员顺序或检查语句顺序，调用方不得依赖它，更不得据此分支。
  1. `rootNodeId` 与每个 `nodes[i].id`、`objects[i].id` 必须非空（`empty-id`）；`nodes` 内 id 唯一（`duplicate-node-id`），`objects` 内 id 唯一（`duplicate-object-id`）。
  2. `rootNodeId` 必须在 `nodes` 中（`root-missing`）；根节点的 `parentId` 必须为 `null`、`sceneObjectId` 必须为 `null`，且第一版根变换固定为单位变换（`position` 全零、`rotation` 与 `QUAT_IDENTITY` 等价、`scale` 全 `1`，按 `util/math` 的 `EPSILON` 判定；`+w` 与 `-w` 表示同一旋转，两者都算单位变换），作为场景坐标系（`root-invalid`）。
  3. 非根节点必须有父节点（`parent-missing`），且必须引用存在的父节点（`parent-not-found`）；`childIds` 必须引用存在的节点（`child-not-found`）；`childIds` 内不得重复（`duplicate-child`）；父子关系必须双向一致（`parent-child-mismatch`）；整张图不得有环（`cycle`，报告数组顺序中首个不在根可达集合内的节点）。
  4. `sceneObjectId` 非空时必须引用 `objects` 中存在的对象（`object-not-found`）；每个 `SceneObject` 必须由恰好一个节点绑定（`object-unbound`、`object-multiply-bound`，后者的 `nodeIds` 按 id 字符串升序，与 canonical 输出同一顺序，不随 `nodes` 入参顺序变化）。
  5. 绑定了 `SceneObject` 的节点是叶节点，`childIds` 必须为空（`leaf-node-has-children`）。空组节点可以拥有子节点，用于未来层级组织。
  6. `SceneTransform.position`、`rotation`、`scale` 必须是有限数值；旋转必须是单位四元数（长度的单位性按 `util/math` 的 `EPSILON` 判定）；`scale` 三分量不得为零，且“为零”同样按 `util/math` 的 `EPSILON` 判定：任一分量满足 `|分量| <= EPSILON` 即视为零、判为非法（`invalid-transform`，按 position → rotation → scale 报告首个失败通道）。校验通过后经 `math.quatNormalize` 取得 `Quat` brand；不得用它静默修复非单位输入。变换顺序为 `T * R * S`，局部空间到父空间。
    - 【用户确认】`scale` 三分量不得为零由用户于 2026-09-13 确认保留，并同日确认“为零”按 `util/math` 的 `EPSILON` 判定：`|分量| <= EPSILON` 的分量即使矩阵形式上仍可逆也一律非法，实现保持 `approximatelyEqual(分量, 0)`，不改为严格 `=== 0`。`util/math` 中“节点 `scale` 为 0 时拾取必须能跳过该节点”是对不可逆矩阵的独立判断，允许在那里多判一次，不构成本条与 `util/math` 的冲突。修改本条必须先取得用户同意。
- canonical 形式：输出的 `nodes` 按 `id` 字符串升序、`objects` 按 `id` 字符串升序排列（与 `project-codec` 的写出顺序一致）；`childIds` 保留输入给定的顺序，树顺序即显式语义。因此同一逻辑场景的任一合法输入顺序产出同一快照，快照等价、持久化 diff 与 golden 都以该顺序为准；`nodes`/`objects` 的数组顺序不构成身份，也不依赖对象枚举顺序。
- `sceneNodeId`、`sceneObjectId` 只接受 `length > 0` 的字符串，不 trim、不做其他规范化。新身份的来源是 `application/ports/id-generator-port` 的 `IdGeneratorPort`；本模块只负责校验与铸造，不生成身份。
- `sceneSnapshot` 不修改入参，也不自动修复输入：不补齐缺失的 `childIds`、不合并或改写重复 id、不对非法数值做 clamp。
- 输出快照与入参共享容器引用：节点的 `position`/`scale` 对象和 `objects[i].voxels` 原样放进新快照，不做防御性复制。共享不转移所有权，也不改变本模块的不可变性约定——与 `UniformVoxSnapshot` 相同，只允许所有者产出新容器，不得就地改写已被快照引用的容器。
- `SceneObjectSnapshot.voxels` 使用该对象自己的局部 `VoxelKey` 网格。`VoxelKey` 不在场景级唯一；跨对象引用必须显式携带目标对象身份（`SceneObjectId` 与该对象的局部 `VoxelKey`）。
- 当前 V1 的 `SceneObjectSnapshot` 采用 Uniform voxel baseline：`voxels` 直接是局部 `UniformVoxSnapshot`。Scene 层只依赖 `SceneObject` 的快照边界，不读取 Uniform 网格内部结构；未来其他对象类型应在其自身契约中定义原生操作，并在需要通用体素处理时显式 flatten/bake 为该 Uniform 表示。
- `SceneNodeSnapshot.visible` 只控制节点及其子树的渲染参与。最终有效可见性是自身及所有祖先 `visible` 的逻辑与；它不表示可编辑性，也不删除任何对象或体素。新建节点（含新建项目的根节点）一律取 `visible = true`；关闭可见性只能由 `set-scene-object-visibility` 显式发生。
- `SceneNodeSnapshot.name` 只用于展示，不参与身份：`trim` 后必须非空，允许重名，长度不限，不规范化也不改写用户输入。名称合法性由命令层在 `rename-scene-node`/`create-scene-object` 处校验，**不属于** `sceneSnapshot` 的结构不变量——历史或手工文件里的空名不会导致整个项目打不开。
- 快照只包含可结构化克隆的普通数据，可直接传给 Worker 或持久化边界；禁止 Three.js、DOM、类实例和函数。容器是普通只读对象/数组；唯一例外是 `voxel/uniform/types` 的 `UniformVoxSnapshot`（typed array 无法冻结，其不可变性由“只允许所有者产出新容器”的约定保证，见 `codemap/README.md` 的类型收敛规则）。
- 可恢复的校验失败返回 `Result` 和具体错误码；不得静默丢弃节点、对象、父子关系或非法变换。

**依赖**：voxel/uniform/types、util/math、util/result。
