# project-codec.ts

**职责**：版本化项目文档编解码与结构校验。
**接口**：encode、decode、version、validate、encodeSnapshot、decodeSnapshot。
**内部**：组合项目元数据、旧体素字符串、可选 cameraAnimation、当前项目的 camera/render 设置和 Bake Mesh manifest；只处理纯数据，不解释 Three.js 规则、不写 repository、不修改运行时状态。
**依赖**：project、legacy-voxel-codec、baked-mesh-codec、animation。

## 本重构必须补齐

项目 codec 必须保留 shithill 可读的旧格式，同时为新功能提供明确版本。写入新项目时使用数字 `version`；读取时同时接受旧的 `version: "Voxel World ..."` 字符串格式。

```text
ProjectDocumentV2 {
  format: "vox-world-project";
  version: 2;
  project: {
    name: string;
    voxelCount: number;
    createdAt?: string;
    updatedAt?: string;
  };
  data: {
    voxels: string;                 // legacy-voxel-codec 字符串
  };
  cameraAnimation?: CameraAnimationV1; // 缺失等价于空动画
  camera?: ProjectCameraSettingsV1;    // 当前项目持久字段；旧项目可缺失
  render?: ProjectRenderSettingsV1;    // 当前项目持久字段；旧项目可缺失
  bakedMeshes?: BakedMeshManifestV1[];
  metadata?: {
    applicationVersion?: string;
    sourceProjectId?: string;
  };
}
```

## 校验与兼容

- `data.voxels` 必须是字符串；空字符串表示空体素文档，不是缺失字段。
- `cameraAnimation` 缺失、为 `null` 或旧记录没有该字段时，解码结果必须是空默认动画；恢复后播放状态为 `stopped`，当前时间为 0。
- 旧 keyframe 缺少 `version`、`easing` 或含非法数值时，由 `animation` 迁移规则过滤非法帧并保留合法帧，不能因单个坏帧丢弃整个项目。
- `camera`、`render` 是当前项目必须持久化的普通 JSON 设置，不是仅供旧版本读取的兼容字段。新写入项目必须同时包含二者，值由 `render-settings-service.toProjectSettings()` 生成；codec 不填充默认值、不解释 tonemap/PBR/PathTracer 语义。
- 旧项目缺少 `camera`、`render` 或其中任一子字段时必须允许解码；ProjectService 在迁移/校验后把缺失部分交给 `render-settings-service` 回退默认值。未知旧字段必须允许解码，新写入只写当前 codec 支持的字段，不把运行时 camera、DOM、Three.js 对象、HDRI 二进制或 GPU 句柄写入项目。
- `bakedMeshes` 只保存 geometry/material 资产引用、名称、transform 和版本，不把 Three.js 对象或材质参数内联到 JSON；资产字节由 `baked-mesh-codec` 编码、repository 保存。
- 当前版本为 2，未知更高版本返回 `UNSUPPORTED_PROJECT_VERSION`；不得降级重写未知版本。
- 解码为纯操作：全部字段验证成功后才返回 ProjectDocument。服务层负责在提交前迁移并替换当前会话。

## Snapshot 条目

`encodeSnapshot`/`decodeSnapshot` 复用项目 codec，但使用 snapshot 条目而不是普通项目文件：

```text
SnapshotProjectEntry {
  format: "vox-world-project";
  version: 2;
  project: { name: string; voxelCount: number };
  data: {
    voxels: string;
    shot?: string;                  // data:image/... 缩略图
    name?: string;                  // 命名 Snapshot 的兼容名称
  };
  snapshot?: {
    slot: number;
    name: string;
    createdAt?: string;
    updatedAt: string;
  };
  cameraAnimation?: CameraAnimationV1;
}
```

旧归档只有 `project`、`cameraAnimation`、`data.voxels`、`data.shot`；缺少 `snapshot` 时使用 `project.name` 或槽位名生成名称。Snapshot 的相机与渲染设置不写入归档，保持 shithill 行为。

## 失败原子性

- encode 对不可序列化值、超大字符串、非法名称和超过版本上限的资产数量直接失败，不生成可下载的半文件。
- decode 不修改当前项目。调用方必须完成迁移、资产校验和所有 fallback 后才能一次性提交。
- 项目保存先写 Bake Mesh 资产，再原子替换项目文档；任一步失败时旧项目及其资产引用保持可用。
