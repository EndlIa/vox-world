# snapshot-service.ts

**职责**：实现 Quick Save、命名 Snapshot 槽位、缩略图、配额管理和本地备份/恢复事务。
**接口**：saveQuick、restoreQuick、listSnapshots、saveSnapshot、restoreSnapshot、deleteSnapshot、createLocalBackup、restoreLocalBackup、quota、subscribe、cancel。
**内部**：组合 voxel-codec、project-codec、snapshot-archive-codec 和 repository；不访问 DOM、不生成缩略图、不处理外部归档导入。
**依赖**：repository-port、project-codec、voxel-codec、snapshot-archive-codec、animation。

## 本重构必须补齐

shithill 只提供编号槽位和“保存/删除/恢复”行为。目标架构必须补齐名称、时间戳、配额预检、严格回滚、备份恢复和可取消的大记录操作。

## localStorage 键与槽位

| 数据 | 键 | 说明 |
| --- | --- | --- |
| Quick Save | `vox-world.quick-save` | 单槽，恢复完整 `SceneSnapshot` 和 `AnimationDocumentV1` |
| Snapshot 记录 | `vox-world.snapshot.${slot}` | `slot` 从 0 开始 |
| Snapshot 缩略图 | `vox-world.snapshot-thumbnail.${slot}` | PNG/JPEG data URL |
| Snapshot 数量 | 用户偏好中的 `snapshotCount` | 1..100，默认 6 |

最大 100 槽。超过上限拒绝请求，不自动覆盖或移动槽位。

## DTO

```text
StorageRecordV1 {
  version: 1;
  name: string;
  scene: SceneDocumentV1;
  animation: AnimationDocumentV1;
  createdAt?: string;
  updatedAt: string;
}

SnapshotSummary {
  slot: number;
  occupied: boolean;
  name: string;
  updatedAt?: string;
  thumbnailAvailable: boolean;
  estimatedBytes: number;
}

SaveSnapshotRequest {
  slot: number;
  name: string;
  expectedVersion?: string;
  thumbnailDataUrl?: string;
  signal?: AbortSignal;
}

QuotaStatus {
  usedBytes: number;
  estimatedLimitBytes?: number;
  reclaimableBytes: number;
  unit: "utf16" | "bytes";
}
```

`AnimationDocumentV1` 由 `domain/animation` 唯一拥有；`StorageRecordV1` 只是持久化包装，不重新声明动画轨道 DTO。Quick Save 使用同一 `StorageRecordV1`，名称固定为 `Quick Save`，不保存缩略图。记录只接受当前版本和完整字段；`animation` 必须使用同一记录的 `scene` 完成完整校验，包括文档内轨道 ID 唯一、单轨关键帧 ID 唯一、每轨至少一个关键帧、`durationMs` 为有限数且 `> 0`、同一 `target` + `channel` 唯一、节点目标存在且非根及关键帧规则。未知版本、缺字段、旧 `cameraAnimation` 字段或损坏 JSON 直接返回错误，不尝试迁移或兼容旧格式。

## 保存事务

1. 捕获不可变的 authored/base `SceneSnapshot` 和 `AnimationDocumentV1` 快照；不得捕获 `AnimationEvaluation`、当前播放时间或运行时 override。
2. 校验名称：trim 后非空、长度受限；缩略图必须是允许的图片 data URL。
3. 用 repository 估算记录与缩略图的 UTF-16 总配额，但最终仍必须处理真实 `QuotaExceededError`。
4. 读取现有记录和现有缩略图到内存，作为回滚值。
5. 先提交 Snapshot 记录；成功后才提交缩略图。这里的“记录优先”只决定提交顺序，用户可见结果仍是原子槽位：缩略图失败时恢复原记录与原缩略图。
6. 全部写入和长度校验成功后发布 `updated` 事件；任何失败都恢复原槽位，并返回 `QUOTA_EXCEEDED`、`SERIALIZATION_FAILED` 或 `ROLLBACK_FAILED`。

禁止在失败时报告“已保存”。若回滚自身失败，必须保留可恢复的临时值并在错误中报告键名，后续启动修复流程优先恢复。

## 删除、恢复与命名

- `deleteSnapshot` 删除记录和缩略图。两项删除按一个逻辑事务报告；失败项不得标记为空槽。
- `restoreSnapshot` 先完整解码，并使用该记录自己的 `scene` 校验 `AnimationDocumentV1`（包括文档/关键帧 ID 唯一、每轨至少一个关键帧、`durationMs` 为有限数且 `> 0`、节点目标存在且非根、同一 `target` + `channel` 唯一及关键帧合法性），再一次性替换场景与动画。失败时当前项目和槽位均不变。
- 名称 trim 后不能为空；默认名使用 `Snapshot ${slot + 1}`。同一名称允许存在，但 UI 必须以槽位 id 定位，禁止按名称选择记录。
- 空槽、超出槽位范围、非当前版本和损坏记录返回明确错误；不得把空槽恢复为空白项目。
- 恢复 Quick Save 与命名 Snapshot 都必须清除 Camera Control，并将动画播放状态重置为停止。
- 播放、暂停、seek、`AnimationEvaluation` 和节点/相机 override 都是运行时状态，不进入 StorageRecord、Quick Save、命名 Snapshot 或本地备份，也不得写回 `SceneDocument`。

## 配额策略

- 计算口径与 shithill 一致：localStorage 当前字节数为所有键值 `(key.length + value.length) * 2`，显示 Bytes/KB/MB/GB。
- 保存前报告所需字节、已用字节和可回收字节。不得自动删除命名 Snapshot 来腾空间。
- 缩略图是可选视觉附件，但一旦请求保存缩略图，就必须按原子槽位语义处理；不能留下“新场景 + 原缩略图”或反向组合。
- 配额失败不改变 dirty 状态。Quick Save 或用户显式启用的降级 autosave 失败时保留项目 dirty，等待用户处理。

## 本地备份与恢复

- `createLocalBackup` 读取所有占用槽位，通过 `snapshot-archive-codec` 生成 Blob；没有缩略图的槽位仍备份场景数据，Quick Save 是否包含由显式选项决定，默认不包含。
- `restoreLocalBackup` 仅接受由本应用生成的备份 Blob/句柄或已完成校验的内部归档，不是通用外部 ZIP 导入入口。
- 恢复前先验证整个归档，保存当前占用槽位的内存回滚快照，再清空目标槽位并写入。任何解析、配额或写入失败都恢复原槽位。
- 恢复进度按条目报告；在 `committing` 前取消不改变 localStorage，提交后取消返回 `CANCELLED_TOO_LATE`。
- 外部 Snapshot ZIP 导入、任意第三方 ZIP 解析和覆盖策略属于 import 侧，本模块明确不实现。

## 生命周期

- 服务不持有 DOM 图片；缩略图由调用方生成后作为 data URL 传入。
- 事件订阅只暴露 `SnapshotSummary`，不暴露 localStorage 引用。
- 页面卸载时不需要 flush 异步写入；localStorage 操作必须同步完成或明确失败。备份 Blob 与 reader/writer 在成功、失败或取消后都必须释放。
