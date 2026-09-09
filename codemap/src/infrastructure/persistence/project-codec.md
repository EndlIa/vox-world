# project-codec.ts

**职责**：编码、解码并严格校验当前 V1 项目文档与 Snapshot 条目。
**接口**：encode、decode、version、validate、encodeSnapshot、decodeSnapshot。
**内部**：组合项目元数据、场景快照、cameraAnimation、camera/render 设置和 Bake Mesh manifest；只处理纯数据，不解释 Three.js 规则、不写 repository、不修改运行时状态。
**依赖**：project、scene-types、scene-query、voxel-codec、baked-mesh-codec、animation。

## 当前格式

当前且唯一支持的版本为 `1`。项目文件和 Snapshot 条目各自拥有独立的 `version: 1`；本地存储记录由 `snapshot-service` 以 `StorageRecordV1` 表达。三者都只使用当前 DTO。codec 不检测或迁移其他版本；任何非 `1` 的项目版本返回 `UNSUPPORTED_PROJECT_VERSION`。

```text
ProjectDocumentV1 {
  format: "vox-world-project";
  version: 1;
  project: {
    name: string;
    voxelCount: number;
    createdAt?: string;
    updatedAt?: string;
  };
  data: {
    scene: SceneDocumentV1;
  };
  cameraAnimation: CameraAnimationV1;
  camera: ProjectCameraSettings;
  render: ProjectRenderSettings;
  bakedMeshes: BakedMeshManifestV1[];
  metadata?: {
    applicationVersion?: string;
    sourceProjectId?: string;
  };
}

SceneDocumentV1 {
  version: 1;
  rootNodeId: string;
  nodes: Array<{
    id: string;
    parentId: string | null;
    childIds: string[];
    name: string;
    transform: {
      position: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number; w: number };
      scale: { x: number; y: number; z: number };
    };
    visible: boolean;
    objectId: string | null;
  }>;
  objects: Array<{
    id: string;
    voxels: string;             // 对象局部 voxel-codec 字符串
  }>;
}
```

- `nodes` 和 `objects` 的数组顺序不构成身份；身份由稳定字符串 id 决定。写出时按 id 稳定排序，`childIds` 保留树顺序。
- `voxels` 字符串只解释为该对象局部 `VoxelKey` 网格。不同对象允许拥有完全相同的局部坐标。
- `project.voxelCount` 是所有对象体素数量之和，仅作为元数据；真实数量以场景对象为准。
- 空场景仍必须包含根节点和空的 `objects` 数组。
- `cameraAnimation`、`camera`、`render` 和 `bakedMeshes` 是当前格式的必填字段；新项目由显式默认值生成它们，缺失字段属于无效文档。

## 严格校验

- `format` 必须精确匹配，`version` 必须为数字 `1`；`data.scene.version` 也必须为 `1`。
- 节点/对象 id 非空且唯一，父子关系双向一致、无环、每个对象恰好被一个节点引用，且满足 `scene-types` 全部不变量。
- 每个 `voxels` 字符串必须能由 `voxel-codec` 严格解析为局部快照；解析失败返回带对象 id 和段索引的错误。
- 变换数值必须有限，rotation 为单位四元数，scale 三分量非零；根节点必须 `parentId === null` 且 `objectId === null`。
- `cameraAnimation` 必须是合法的 `CameraAnimationV1`；未知版本、非法字段或非法关键帧使整个文档失败，不进行关键帧过滤。
- `camera`、`render` 必须是完整的当前 `ProjectCameraSettings`/`ProjectRenderSettings`；字段缺失、旧字段别名、非法值或未知枚举使整个文档失败。
- `bakedMeshes` 只保存 geometry/material 资产引用、名称、对象/节点来源和 transform；不把 Three.js 对象或材质参数内联到 JSON。
- 解码为纯操作，全部字段验证成功后才返回 DTO；任何错误都不得返回部分项目或修改当前会话。

## Snapshot 条目

`encodeSnapshot`/`decodeSnapshot` 复用项目 codec 的场景与动画校验，但使用独立的 Snapshot 条目格式：

```text
SnapshotProjectEntry {
  format: "vox-world-project";
  version: 1;
  project: { name: string; voxelCount: number };
  data: {
    scene: SceneDocumentV1;
    shot?: string;
    name?: string;
  };
  snapshot: {
    slot: number;
    name: string;
    createdAt?: string;
    updatedAt: string;
  };
  cameraAnimation: CameraAnimationV1;
}
```

- Snapshot 条目必须包含完整 `SceneDocumentV1` 和 `CameraAnimationV1`。
- Snapshot 有意不保存 camera/render 设置和 Bake Mesh；恢复时保留当前项目设置，这是格式边界，不是缺字段回退。
- 条目中的 `slot` 必须为 `0..99` 整数，`name` trim 后非空且与 `snapshot.name` 一致。

## 失败原子性

- encode 对不可序列化值、超大字符串、非法名称和超过版本上限的资产数量直接失败，不生成可下载的半文件。
- decode 不修改当前项目。调用方只有在完整解码、资产校验和场景提交预检全部成功后才能一次性替换会话。
- 项目保存先写 Bake Mesh 资产，再原子替换项目文档；任一步失败时原项目及其资产引用保持可用。
