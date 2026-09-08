# repository.ts

**职责**：统一实现 IndexedDB、localStorage、File System Access 和 Electron 文件系统的持久化适配器。
**接口**：load、save、saveAtomic、list、stat、remove、removeMany、transaction、estimateQuota、supports、abort。
**内部**：以版本化文档和二进制资产为边界，隐藏各平台差异；提供原子写入、临时记录/文件替换、回滚和错误分类。
**依赖**：repository-port、platform-port。

## 本重构必须补齐

当前目标侧只声明了通用 repository，必须同时承接以下既有和新增长期数据：

| 数据类型 | 后端 | 写入语义 |
| --- | --- | --- |
| 项目文档 | IndexedDB、文件系统、Electron | 原子替换，成功后产生新版本 |
| Quick Save | localStorage | 覆盖 `vbstore_voxels`，失败保留旧值 |
| 命名 Snapshot | localStorage | 槽位记录与缩略图成组提交或整体回滚 |
| Snapshot 归档 | Blob/文件系统 | 全部内容生成成功后才暴露下载/落盘句柄 |
| Bake Mesh manifest | 项目文档 | 与项目版本一起提交 |
| Bake Mesh geometry/material 资产 | IndexedDB/文件系统 | 内容先落盘，manifest 后提交；失败不得产生半项目 |
| 归档/项目二进制附件 | IndexedDB/文件系统 | 与 JSON 文档分记录保存，通过稳定 asset id 引用 |

## Repository DTO

```text
RepositoryRecordKey {
  namespace: "project" | "snapshot" | "thumbnail" | "baked-mesh" | "archive";
  id: string;
  revision?: string;
}

RepositoryRecord {
  key: RepositoryRecordKey;
  mediaType: string;
  bytesOrDocument: ArrayBuffer | string | ProjectDocument;
  metadata: {
    version: number;
    createdAt?: string;
    updatedAt: string;
    byteLength: number;
    checksum?: string;
  };
}

RepositoryCapabilities {
  atomicReplace: boolean;
  transactions: boolean;
  binaryAssets: boolean;
  quotaInspection: boolean;
  quotaBytes?: number;
}
```

`saveAtomic` 必须先完成序列化、校验和容量预检，再替换可见记录。localStorage 无法提供真正事务时，实现必须读取旧记录，按“移除旧值 → 写新值 → 失败时恢复旧值”的顺序提交；任何 `QuotaExceededError`、序列化失败或平台 I/O 失败都不能报告成功。

## 原子写入与回滚

- IndexedDB：所有关联记录使用同一 read-write transaction；任一 `put/delete` 失败则 transaction abort。
- 文件系统/Electron：写入同目录临时文件，校验长度和校验和后原子 rename；失败删除临时文件，保留原文件。
- localStorage：snapshot 数据、名称、缩略图视为一个逻辑记录。若任一步写入失败，删除所有新值并恢复原值；恢复失败必须返回 `ROLLBACK_FAILED`，由服务层明确提示数据风险。
- Bake Mesh：新资产先写入不可见临时 id，项目 manifest 原子提交成功后再标记为正式资产；失败删除临时资产。
- 删除多个记录时返回逐项结果；部分失败不得把未删除项报告为已删除。

## 配额、进度与取消

- `estimateQuota()` 至少提供当前字节数、估算上限和可回收字节数。浏览器 localStorage 使用 UTF-16 口径 `(key.length + value.length) * 2`，IndexedDB/文件系统使用实际字节数。
- 容量不足统一返回 `QUOTA_EXCEEDED`，保留 `requiredBytes`、`availableBytes` 和可安全回收的候选记录，不在 repository 内自动删除用户项目或命名 Snapshot。
- `saveAtomic` 接受 `AbortSignal`。取消发生在可见提交前时不得改变原记录；提交后取消返回 `CANCELLED_TOO_LATE`，不能伪装成成功或失败。
- 大对象写入报告 `preparing`、`writing`、`verifying`、`committing` 进度。进度回调不得暴露半写记录。

## 生命周期与版本

- 每个 namespace 记录包含独立版本；项目文档版本由 `project-codec` 决定，repository 只保证字节/文档原样读写。
- 读取未知更高版本时返回 `UNSUPPORTED_VERSION`，不得尝试猜测或截断数据。
- 删除项目时同时清理仅被该项目引用的 Bake Mesh 资产；共享资产按引用计数延迟回收。
- `supports()` 必须明确区分项目文档、localStorage snapshot、二进制资产和原子 rename 能力，调用方不得假设所有后端能力相同。
