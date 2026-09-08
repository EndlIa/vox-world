# exporters.ts

**职责**：项目体素、Baked Mesh、图片和视频导出的格式适配器门面。
**接口**：exportProject(format, options, onProgress, signal)、capabilities、cancel、dispose。
**内部**：从只读项目/选择快照生成文件；按 Raw Voxels 与 Baked Mesh 分流到独立格式适配器，复杂导出进入 Worker 或离线渲染流程。
**依赖**：project、baked-mesh-codec、worker-port、platform-port。

## 本重构必须补齐

当前目标文档只写了通用 OBJ/GLTF/PLY 导出，必须明确补齐 shithill 的 VOX 导出、STL 导出，以及 Raw Voxels 与 Baked Mesh 的格式/错误/进度差异。图片序列和视频仍由动画导出流程承接，本模块只保留适配器边界。

## 格式能力矩阵

| format | scope | 几何 | 顶点色 | 材质/纹理 | 关键限制 |
| --- | --- | --- | --- | --- | --- |
| `vox` | Raw Voxels | 体素 | 调色板颜色 | 无 | MagicaVoxel VOX 200；256 色槽；坐标 0..255 |
| `obj_raw` | Raw Voxels | 可见/隐藏体素的表面几何 | 无 | 无 | OBJ 文本；不表达 PBR |
| `stl_raw` | Raw Voxels | 表面几何 | 无 | 无 | 几何 only；默认 ASCII，可请求 binary |
| `ply_raw` | Raw Voxels | 表面几何 | 可写顶点色 | 无纹理引用 | 不保留材质图 |
| `glb` | Baked All/Selected | 完整 mesh | 支持 | PBR scalar + maps | 单文件二进制 |
| `gltf` | Baked All/Selected | 完整 mesh | 支持 | PBR scalar + maps | 单文件 JSON，资源必须内嵌 data URI |
| `obj` | Baked All/Selected | 完整 mesh | 受 OBJ 能力限制 | 不保证 MTL/纹理 | 只保证几何、UV 可用性 |
| `stl` | Baked All/Selected | 完整 mesh | 无 | 无 | 只保留几何和 transform 语义 |
| `ply` | Baked All/Selected | 完整 mesh | 支持 | 纹理退化为采样顶点色 | 不导出纹理引用 |

Baked Mesh 导出前必须存在至少一个 Baked Mesh。`selected` scope 未选择对象时返回 `NO_SELECTED_MESH`；`all` scope 在空池上返回 `NO_BAKED_MESHES`。Raw 导出不依赖 Bake 池。

## ExportRequest DTO

```text
ExportRequest {
  format: "vox" | "obj_raw" | "stl_raw" | "ply_raw" |
          "glb" | "gltf" | "obj" | "stl" | "ply";
  scope: "rawVoxels" | "bakedAll" | "bakedSelected";
  fileName: string;
  documentVersion: number;
  selectedMeshId?: string;
  options: {
    binaryStl?: boolean;
    embedTextures?: boolean;        // GLTF 默认 true，拒绝外部 sidecar
    maxTextureSize?: 4096;          // shithill 兼容值，其他值拒绝
  };
  signal?: AbortSignal;
}
```

`fileName` 去除路径分隔符和非法字符；空值回退为 `untitled`。导出必须基于开始时捕获的不可变快照，不允许在异步过程中读取正在变化的 VoxelDocument 或 mesh pool。

## VOX 导出

**本重构必须补齐**：`vox` 只导出 Raw Voxels，不从 Baked Mesh 反向重建体素。

- 输出 MagicaVoxel VOX 200，包含 `MAIN`、`SIZE`、`XYZI`、`RGBA` 块。
- 尺寸映射为 `SIZE = { x: dim.x, y: dim.z, z: dim.y }`；每个体素先按文档包围盒中心平移，再映射为 `x = adjustedX + dim.x / 2`、`y = -adjustedZ + dim.z / 2`、`z = adjustedY + dim.y / 2`。
- 颜色按 RGBA 去重；按 shithill 的调色板映射保留索引 0 和首个占位项，真实去重颜色从 2 开始，剩余槽填 `(0,0,0,255)`，RGBA 块始终写出 256 项。
- 坐标必须落在 0..255；超过 255 或唯一颜色超过 255 返回 `VOX_CAPACITY_EXCEEDED`，不得截断、取模或丢体素。
- 空文档返回 `EMPTY_EXPORT`。VOX 不表达体素可见性；为保持 shithill 行为，文档中的隐藏体素仍写出为普通体素。
- 写入前先从当前只读文档快照重建体素缓冲，保证颜色与位置一致；不使用 Baked Mesh 的材质。

## STL 导出

**本重构必须补齐**：STL 同时支持 Raw Voxels 与 Baked Mesh，但只输出三角几何。

- `stl_raw` 从 Raw Voxels 生成表面三角；`stl` 从 Baked All/Selected 生成三角。
- 默认 ASCII STL，与现有 vendored `STLExporter` 路径一致；`binaryStl: true` 输出二进制 STL。
- 不导出颜色、PBR 参数、纹理、对象名称或层级；这些信息丢失必须在 UI 中提示。
- Baked Mesh 的 position、rotation/quaternion、scale 必须应用为相同世界变换。不能只应用 position，也不能把 selected 与 all 变换语义分开处理。
- 非法或退化三角应跳过并报告 warning；若最终没有有效三角则返回 `EMPTY_EXPORT`。

## GLB/GLTF 导出

**本重构必须补齐**：GLB/GLTF 是 Baked Mesh 的主要 PBR 路径。

- `glb` 使用 `binary: true`，返回单个二进制文件；`gltf` 使用 `binary: false`，返回单个 JSON 文件，buffer 与图片必须内嵌为 data URI，禁止依赖未下载的 `.bin`/图片 sidecar。
- GLTFExporter 选项固定为 `trs: false`、`maxTextureSize: 4096`、`onlyVisible: false`。`onlyVisible: false` 用于保证导出 scope 不被当前预览可见性误过滤；Baked All 包含池内全部 mesh，Baked Selected 包含指定 id 的 mesh，即使当前处于隐藏状态。
- 完整保留每个对象名称和世界变换。`trs: false` 会把 position、rotation/quaternion、scaling 合成 node matrix 写入，禁止只应用 position 或把三者烘焙成不同的顶点坐标；selected 与 all 使用同一转换函数。
- PBR scalar factor 与顶点色是两套独立语义：base color factor、metallic、roughness、emissive、alpha 等数值不得写入颜色属性；顶点色不得替代 metallic/roughness 数据。
- 导出 base-color 和 metallic-roughness 纹理。存在 emissive/normal/alpha 元数据时按材质能力导出；不支持或缺失的纹理保持缺失，不注入 atlas。
- 纹理 `flipY` 必须与 UV 方向一致；颜色纹理使用 sRGB，metallic-roughness、normal、alpha、occlusion 和其他数据纹理使用线性/NoColorSpace 语义。
- `textureless: true` 或无 albedo texture 的 mesh 必须保持无纹理。不得因为同批次其他 mesh 使用 voxel atlas 而自动添加该 atlas。
- 纹理编码失败、压缩超限或资产引用缺失时整批失败，返回 `TEXTURE_ENCODE_FAILED`/`MISSING_TEXTURE_ASSET`，不生成缺图但仍声称成功的文件。

## OBJ/PLY 导出

- OBJ 只保证几何与可用 UV；当前 vendored 路径不承诺 MTL、纹理 companion files 或可靠材质往返。
- PLY Baked 导出允许把 base-color 纹理按 UV 采样为顶点色；采样必须遵守 `flipY` 和 sRGB→线性规则，不能把 metallic/roughness 数据混入顶点色。
- PLY 不写纹理引用，OBJ/STL 不保证 PBR；调用方必须根据 capability matrix 决定 UI 提示。
- Raw 与 Baked 导出都使用相同坐标轴和单位，禁止一个路径额外翻转 Y/Z。

## Selected/All 一致性与对象名称

- `bakedSelected` 通过不可变 mesh id 选择对象，不通过名称。重命名后仍选中同一对象引用/id。
- `bakedAll` 按稳定顺序导出全部 Baked Mesh；selected 导出同一对象时，其几何、材质、名称和世界变换必须与 all 中的结果一致。
- 名称先 trim；空名称拒绝修改并保留旧值；重复名称确定性添加 `_2`、`_3`。多对象格式中名称必须唯一。
- 生成器名称（如 `m1`）只作为默认名称，导出时以用户当前名称为准。

## 进度、取消与失败原子性

- 阶段：`snapshot` → `prepareMeshes` → `encode` → `verify` → `finalize`。
- Worker 导出报告对象/纹理/块级进度；主线程只接收不可变进度事件。
- `signal.aborted` 时停止遍历、终止 Worker、释放临时 geometry/material/texture 和 Blob URL，返回 `CANCELLED`。
- 全部字节生成并通过空文件/结构校验后才暴露 Blob 或下载句柄；取消或失败绝不下载部分文件，也不覆盖已有目标文件。
- `dispose()` 只清理导出临时资源，不 dispose 项目或 Bake 池拥有的共享资产。
- 本模块不负责导入、外部 GLB 解析、Unbake、Load Bakes 或 glTF-compatible editor。
