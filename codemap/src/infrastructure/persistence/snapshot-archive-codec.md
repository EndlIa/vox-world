# snapshot-archive-codec.ts

**职责**：定义当前 Snapshot 归档的 ZIP 条目格式，负责写出、校验和本地备份解码。
**接口**：encodeArchive、encodeEntry、inspectArchive、decodeLocalBackup、validateEntry、suggestFileName。
**内部**：只处理 Blob/ArrayBuffer 与纯数据，不读取 localStorage、不写项目状态、不实现外部归档导入。
**依赖**：project-codec、voxel-codec。

## 归档布局

```text
snapshots_<timestamp>.zip
  manifest.json
  0.json
  1.json
  ...
```

只写占用槽位，槽位按升序排列，文件名使用十进制槽位号且不带前导零。归档不包含 Quick Save，除非调用方显式请求。`manifest.json` 是当前格式的必需入口；没有 manifest 的 ZIP 一律拒绝。

```text
SnapshotArchiveManifestV1 {
  format: "vox-world-snapshots";
  version: 1;
  createdAt: string;
  entries: Array<{
    slot: number;
    file: string;
    name: string;
    updatedAt: string;
    byteLength: number;
    checksum: string;
  }>;
}
```

## 条目 DTO

条目正文直接使用 `project-codec` 的 `SnapshotProjectEntry`，不在归档层另造平行 DTO。每个条目的 `data.scene` 必须包含完整多对象场景，`cameraAnimation` 必须存在且版本为 `1`。归档条目不写 camera/render 设置或 Bake Mesh。

## 写出与校验

- `encodeArchive` 先构造并校验全部 manifest 与条目，再一次性生成 ZIP；任一槽位失败都不返回部分 Blob。
- 缩略图存在时必须是 `data:image/png;base64,...` 或 `data:image/jpeg;base64,...`，尺寸和字节上限由 Snapshot 服务传入；缺失缩略图不阻止数据备份。
- `inspectArchive` 校验 ZIP 可读、`manifest.json` 存在且版本为 `1`、槽位范围 0..99、文件名唯一、条目长度/校验和、JSON 结构、场景节点/对象引用及每个对象的局部 voxel 字符串语法。
- `decodeLocalBackup` 只服务本地备份恢复。它必须完整解码并校验所有当前格式条目后返回完整批次；不能边解析边写 localStorage。
- 外部用户选择的 ZIP、第三方兼容导入和覆盖合并策略明确属于 import，本模块不提供 `importExternal` API。

## 失败原子性、进度与生命周期

- 生成阶段报告 `reading`、`encoding`、`compressing`、`finalizing`；生成完成前不得把 ZIP 暴露给下载层。
- 取消时关闭 JSZip writer 并释放所有 Blob URL/临时句柄，返回 `CANCELLED`，不留下部分归档。
- 归档中的每个条目都是独立只读 DTO；解码结果冻结后交给 Snapshot 服务提交。
- 文件名校验只允许安全的相对 `manifest.json` 和 `\d+\.json`，拒绝路径穿越、目录项、重复槽位和超大压缩炸弹。
