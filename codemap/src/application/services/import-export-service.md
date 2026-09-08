# import-export-service.ts

**职责**：编排导入、导出和体素化任务；本文只补齐导出任务、进度、取消和资源生命周期，不定义导入行为。
**接口**：importFile、exportProject、exportBakedMeshes、progress、cancel、dispose。
**内部**：验证导出请求、捕获只读快照、选择 Raw/Baked 适配器、派发 Worker、报告进度并在提交前保证失败原子性；不阻塞主线程。
**依赖**：worker-port、exporters、project、bake-service、platform-port。

## 本重构必须补齐

目标侧必须提供统一的导出编排，使 UI 不需要了解 VOX、STL、GLB/GLTF、OBJ/PLY 或 Raw/Baked 差异，同时严格区分导出 scope。

## 导出请求与任务

```text
ExportJobRequest {
  format: "vox" | "obj_raw" | "stl_raw" | "ply_raw" |
          "glb" | "gltf" | "obj" | "stl" | "ply";
  scope: "rawVoxels" | "bakedAll" | "bakedSelected";
  fileName?: string;
  selectedMeshId?: string;
  documentVersion: number;
  options?: ExportOptions;
}

ExportJob {
  id: string;
  phase: "queued" | "snapshot" | "prepare" | "encode" | "verify" | "finalize";
  completed: number;
  total?: number;
  cancellable: boolean;
}

ExportResult {
  jobId: string;
  fileName: string;
  mediaType: string;
  blobOrHandle: Blob | FileSystemFileHandle;
  warnings: string[];
}
```

## 编排规则

- `rawVoxels` 从 VoxelDocument 的不可变快照导出，允许 `vox`、`obj_raw`、`stl_raw`、`ply_raw`；不得要求存在 Bake Mesh。
- `bakedAll`/`bakedSelected` 从 bake-service 的不可变 mesh manifest 和资产快照导出，允许 `glb`、`gltf`、`obj`、`stl`、`ply`。
- `bakedSelected` 必须提供 `selectedMeshId`；对象在任务期间被删除或重命名不改变该 id 的选择语义。
- 捕获的 `documentVersion` 与当前文档不一致时，允许继续导出该历史快照，但结果必须标注 source version；若调用方要求最新版本则返回 `STALE_EXPORT_SOURCE`。
- 格式、scope 不匹配时在派发 Worker 前返回 `UNSUPPORTED_EXPORT_COMBINATION`，不得先生成再报错。
- 任务通过 exporters 的格式适配器执行。需要 Three.js 或纹理编码的工作进入 Worker/离线流程；导出只读取项目，不修改体素、Bake Mesh、材质或选择。

## 进度、取消与失败原子性

- 进度事件单调递增，阶段和对象/纹理计数由 Worker 上报；主线程不得通过轮询可变对象伪造进度。
- `cancel(jobId)` 在 `verify` 前中止 Worker、释放临时 geometry/material/texture/Blob URL，返回 `CANCELLED`。
- 进入 `finalize` 后取消返回 `CANCELLED_TOO_LATE`，但已完成结果仍由调用方决定是否保存。
- 只在 `verify` 通过后生成下载或目标文件句柄；编码失败、纹理缺失、容量不足、用户取消都不得留下部分文件或覆盖已有目标。
- 同时运行的导出任务相互隔离。取消一个任务不能释放其他任务或项目拥有的共享资产。
- 错误必须保留 typed code：`NO_BAKED_MESHES`、`NO_SELECTED_MESH`、`EMPTY_EXPORT`、`VOX_CAPACITY_EXCEEDED`、`TEXTURE_ENCODE_FAILED`、`MISSING_TEXTURE_ASSET`、`QUOTA_EXCEEDED`、`CANCELLED`。
- `dispose` 终止所有任务并释放本服务创建的临时资源，不 dispose 项目状态或 Bake 池资产。

## 导入边界

`importFile` 的既有接口保留为应用边界，但本文不定义格式检测、外部归档导入、mesh voxelization、JSON Voxels 导入、Minecraft 导入或外部 GLB 解析。上述行为由 import 专项架构承接，不得通过导出/备份恢复路径绕过。
