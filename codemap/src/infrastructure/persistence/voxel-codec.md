# voxel-codec.ts

**职责**：读写当前项目格式中单个 `VoxObject` 的紧凑体素字符串，并在编解码边界完成严格结构校验。
**接口**：parse、serialize、version。
**内部**：处理 `x,y,z,RRGGBB,visible;` 分号格式，转换为只读 `VoxelSnapshot`；不访问 localStorage，不识别旧存储记录。
**依赖**：voxel-types、voxel-patch、util/color。

## 字符串格式

```text
voxel := x "," y "," z "," color "," visibility ";"
document := voxel*
color := "RRGGBB"
visibility := "0" | "1"
```

- 坐标必须是 16-bit 范围内的十进制整数；颜色必须恰好为六个大写十六进制字符，内部统一为 `#RRGGBB`。
- `1` 表示可见，`0` 表示隐藏；不接受 `true`、`false`、空格或其他别名。
- 每条记录必须以分号结束，包括最后一条；空字符串是唯一合法的空快照表示。
- 重复坐标是当前格式错误，返回 `DUPLICATE_VOXEL_KEY`，不采用后写覆盖。
- 非法坐标、颜色、可见性或缺失分号返回带段索引的 `INVALID_VOXEL_RECORD`。解析失败不返回部分快照。

## 原子性与生命周期

- `parse` 与 `serialize` 是纯操作；`serialize` 只输出规范形式，`parse` 只接受规范形式。
- 每个字符串只解释为一个对象的局部 `VoxelSnapshot`；不同对象可以使用相同局部坐标。
- 调用方必须通过 `project-codec` 或 `snapshot-service` 完成对象身份与场景结构校验；解析失败不能清空当前场景。
- Raw Voxels 导出消费目标对象的只读局部快照，不经过 Baked Mesh。
