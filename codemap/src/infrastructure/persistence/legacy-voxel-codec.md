# legacy-voxel-codec.ts

**职责**：读写 shithill 旧体素字符串，并识别旧 Snapshot 的纯字符串/JSON 存储记录。
**接口**：parse、serialize、detect、detectStorageRecord、migrate。
**内部**：处理 `x,y,z,RRGGBB,visible;` 分号格式，转换为领域补丁或只读快照；不访问 localStorage。
**依赖**：voxel-types、voxel-patch、util/color、animation。

## 字符串格式

```text
voxel := x "," y "," z "," color "," visibility ";"
document := voxel*
color := "RRGGBB" | "#RRGGBB"
visibility := "0" | "1" | "false" | "true"
```

- 坐标解析后截断为整数；颜色统一为内部大写 `#RRGGBB`，输出时可保持 shithill 的无 `#` 形式。
- `1` 和旧值 `true` 表示可见，`0` 和 `false` 表示隐藏。
- 最后一个分号是可选的兼容输入；输出必须包含末尾分号。
- 空字符串合法，表示空体素文档。
- 重复坐标按稳定顺序处理，后出现的记录覆盖前一条，避免同一键产生两个体素。
- 非法坐标、颜色或可见性记录返回带行/段索引的 `INVALID_VOXEL_RECORD`。是否允许跳过必须由调用方通过显式 strict/lenient 选项决定，默认项目加载为 strict，损坏快照恢复为 lenient 并报告警告。

## 存储记录兼容

```text
LegacyStorageInput :=
  | "<legacy voxel string>"
  | {
      version: 1 | 2;
      voxels: "<legacy voxel string>";
      cameraAnimation?: CameraAnimationV1;
      name?: string;
      createdAt?: string;
      updatedAt?: string;
    }
```

`detectStorageRecord` 先尝试 JSON 解析；只有对象含字符串 `voxels` 时才视为记录，否则把原始值视为纯旧体素字符串。纯字符串迁移为版本 1 记录并附带 `cameraAnimation: undefined`；恢复时缺失/非法动画回退为空默认动画。

## 原子性与生命周期

- parse/serialize 是纯操作，失败不产生部分文档。
- 调用方先用 codec 得到完整体素快照，再一次性替换项目状态；解析失败不能清空当前文档。
- 迁移后的记录由 Snapshot 服务负责写入，codec 不直接操作 localStorage，也不删除旧键。
- 新项目仍以该字符串作为 `data.voxels` 的兼容载荷；Raw Voxels 导出直接消费同一只读快照，不经过 Baked Mesh。
