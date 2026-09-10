# bake-service.ts

**职责**：把指定 `VoxObject` 或整个场景的 Raw Voxels 烘焙成可编辑、可导出、可持久化的 Baked Mesh，并管理其运行时生命周期。
**接口**：bake、rename、select、deselect、setVisibility、setTransform、updateMaterial、deleteSelected、deleteAll、list、dispose、cancel。
**内部**：按全量/颜色/岛分组生成 mesh，处理内部面剔除、PBR 材质克隆、命名、进度和原子提交；不导入外部网格、不执行 Unbake。
**依赖**：scene-document、scene-types、baked-mesh-codec、repository-port、renderer-port、worker-port。

## 本重构必须补齐

`mesh-buffer-worker` 只服务导出/BVH，不能替代 Bake 资产模型。本模块必须补齐 Bake Voxels to Mesh、Bake Mesh 生命周期和项目持久化；Load Bakes、Unbake GLB to Voxels、外部 GLB 导入明确排除。

## Bake 请求与结果

```text
BakeRequest {
  scope: "scene" | "object";
  objectId?: VoxObjectId;
  mode: "all" | "color" | "colors" | "islands";
  sourceSceneVersion: number;
  color?: "#RRGGBB";
  islandConnectivity?: 6 | 26;       // islands 默认 26
  replaceExisting: boolean;          // shithill Bake All/Colors/Islands 为 true
  signal?: AbortSignal;
}

BakeResult {
  operationId: string;
  sourceSceneVersion: number;
  meshes: BakedMeshManifest[];
  warnings: Array<{
    code: "COLOR_LIMIT" | "DEGENERATE_FACE" | "EMPTY_GROUP";
    detail?: string;
  }>;
}

BakeProgress {
  phase: "snapshot" | "group" | "build" | "material" | "persist" | "commit";
  completed: number;
  total?: number;
  operationId: string;
}
```

## 几何契约

- `scope = "object"` 时只为目标对象局部网格生成三角，并保留该对象 `objectId`；`scope = "scene"` 时按场景节点世界变换组合所有可见对象，并保留每个源对象/节点身份。`objectId` 在 object scope 必填，在 scene scope 禁止。
- 只为“邻接体素不存在”或“邻接体素颜色不同”的面生成三角；共享且同色的内部面必须剔除。不同对象的相邻体素不得跨对象错误剔除。
- `all` 生成一个合并 mesh；`color` 生成指定颜色；`colors` 按唯一颜色分组，最多 100 个颜色对象，超限返回 `BAKE_COLOR_LIMIT` 且不修改现有池；`islands` 默认按 26 邻域分组，调用方可显式改为 6 邻域。
- 每个生成 mesh 使用稳定对象 id，重置 pivot 后名称默认为 `m1`、`m2`……；重名通过 `_2`、`_3` 确定性去重。
- geometry 保留 position、normal、uv、可用顶点色和 index。颜色仍按 shithill 语义进入顶点色，不把颜色写入 metallic/roughness 数据属性。
- 生成完成后设置非碰撞、接收阴影，并创建独立 PBR material clone。材质名与纹理名跟随对象名，例如 `mat_m1`、`tex_m1`；共享纹理按引用管理。
- `textureless` mesh 不自动注入 voxel atlas。无 albedo texture 时保留 scalar factor/顶点色。

## 原子提交与取消

1. 捕获指定 `sourceSceneVersion` 的只读场景/对象快照；版本已变化则返回 `STALE_BAKE_SOURCE`。
2. 在 Worker/临时资产中分组和构建，不修改当前 mesh 池。
3. 全部几何和材质校验通过后，以一次提交替换现有池（`replaceExisting`）或追加新 mesh。
4. 若项目已持久化或启用自动保存，提交成功后由 project-service 持久化 manifest 与资产。
5. 任何阶段失败或取消都释放临时 geometry/material/texture，当前 Bake 池保持不变。

进度按阶段和组数报告。`signal.aborted` 在提交前生效；提交后取消返回 `CANCELLED_TOO_LATE`。Worker 不可用时允许分块主线程执行，但必须让出事件循环并保持相同取消语义。

## Mesh 生命周期

| 操作 | 契约 |
| --- | --- |
| select/deselect | 按对象 id 选择，UI 列表选中与 Three.js 对象引用一致 |
| rename | trim 非空；空名称拒绝并恢复旧名；重名加 `_2`、`_3`；选中身份不因改名改变 |
| setVisibility | 只改运行时可见性；导出 scope 仍按对象 id 决定，不因预览隐藏而改变 |
| setTransform | 保存 position、quaternion/rotation、scale；不得只把 position 烘焙进顶点 |
| updateMaterial | 只改目标 mesh 的 PBR 参数/纹理引用，不污染共享资产 |
| deleteSelected | 从池移除、清理选择/gizmo、减少资产引用；保存时 GC 零引用资产 |
| deleteAll | 原子清空池并释放独占资源；共享纹理仍有其他引用时不得 dispose |
| dispose | 页面卸载/项目替换时释放所有独占 geometry、material、texture、BVH 和 Worker 资源 |

所有列表 API 返回只读 `BakedMeshManifest`，不暴露可变 Three.js 对象。对象名称用于显示/导出，不作为持久化主键。

## 持久化与项目恢复

- 项目保存时通过 `baked-mesh-codec` 写出 manifest 和二进制资产；加载同一项目时恢复自己保存的 Bake Mesh。
- 资产先写后提交 manifest；配额/IO 失败时旧项目、旧 mesh 池和旧资产必须保持可恢复。
- 加载项目时先验证 manifest、geometry、material 和纹理引用；缺资产返回 `MISSING_BAKED_MESH_ASSET`，不得静默删除 Mesh 后覆盖项目。
- 不实现 Load Bakes、外部 GLB 导入、Unbake GLB to Voxels 或 glTF-compatible editor。上述功能需要另行立项，不得复用本服务的持久化恢复入口绕过导入边界。
