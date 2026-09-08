# migrations.ts

**职责**：项目、Snapshot 存储记录和 Bake Mesh 资产的顺序版本迁移链。
**接口**：register、migrate、latestVersion、detectVersion、migrateStorageRecord、migrateProject。
**内部**：按相邻版本逐级迁移，先验证再返回新纯数据；拒绝未知更高版本，不修改 repository 或当前会话。
**依赖**：project-codec、legacy-voxel-codec、baked-mesh-codec、animation。

## 本重构必须补齐

| 输入 | 目标 | 迁移规则 |
| --- | --- | --- |
| 纯旧体素字符串 | StorageRecordV1 | `{ version: 1, voxels, cameraAnimation: undefined }` |
| StorageRecordV1 | StorageRecordV2 | 保留 voxels/cameraAnimation；补 `name`、`createdAt`、`updatedAt` |
| 旧项目字符串版本 | ProjectDocumentV1 | 映射 `project`、`camera`、`render`、`data.voxels` |
| ProjectDocumentV1 | ProjectDocumentV2 | 补 `format`、数字版本和 metadata；缺失 cameraAnimation 使用空动画 |
| BakedGeometry/MaterialAsset 未知旧实验格式 | BakedGeometryAssetV1 / BakedMaterialAssetV1 | 只接受可无损转换的 geometry/material 字段；否则报错并要求重新 Bake |
| 无 manifest 的项目 | 空 `bakedMeshes` | 不自动把运行时 mesh 写入项目 |

## 迁移 DTO

```text
MigrationInput {
  kind: "project" | "snapshot-record" | "baked-mesh-asset";
  sourceVersion: number | string;
  value: unknown;
}

MigrationResult<T> {
  value: T;
  fromVersion: number | string;
  toVersion: number;
  warnings: Array<{
    code: "CAMERA_ANIMATION_DEFAULTED" | "CAMERA_KEYFRAME_DROPPED" | "UNKNOWN_FIELD_IGNORED";
    path?: string;
  }>;
}
```

## cameraAnimation 旧数据兼容

- 整个字段缺失、为 `null`、不是对象或没有合法 `keyframes` 数组：结果为空默认动画，产生 `CAMERA_ANIMATION_DEFAULTED` 警告。
- `durationMs` 非有限数或小于 0：回退到默认时长；最后关键帧时间不得大于迁移后的 duration。
- 单个关键帧缺少有限 `timeMs`、position、rotation 或正数 `fov`：只丢弃该帧并产生 `CAMERA_KEYFRAME_DROPPED`；重复时间保留稳定顺序中的最后一项。
- `loop` 非布尔值回退为 `false`，`easing` 非 `linear|smooth` 回退为 `linear`。
- Camera Control、轨迹、marker、播放/暂停状态都是运行时数据，不迁移、不持久化。恢复后必须清除 Camera Control 并将播放状态重置为停止。

## 失败与版本规则

- 迁移必须幂等：对已经处于目标版本的数据再次执行不得改变语义或生成重复 keyframe。
- 逐级迁移中任一步失败都返回错误，不提交部分结果；不得先清空旧项目再尝试迁移。
- 高版本输入返回 `UNSUPPORTED_VERSION`，低版本按链升级。迁移结果可附带 warning，但不能静默丢弃 voxel 记录、Bake Mesh 资产引用或用户名称。
- Snapshot 写入新记录前先迁移到当前版本；Quick Save、命名 Snapshot、归档写出和项目加载共用同一迁移入口。
