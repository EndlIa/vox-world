# pick-result.ts

**职责**：跨拾取实现共享的稳定结果类型。
**接口**：
- `ObjectPickResult`：`{ kind: "object"; objectId; nodeId; point; normal?; distance; source }`。
- `VoxelPickResult`：`{ kind: "voxel"; objectId; nodeId; voxelKey; point; normal; face; distance; source }`。
- `PickResult = ObjectPickResult | VoxelPickResult`。
**内部**：
- Object 模式只返回 `ObjectPickResult`；Edit 模式只返回活动对象的 `VoxelPickResult`。`voxelKey` 是对象局部键，必须与 `objectId` 一起解释。
- 只包含可序列化的普通数据；不携带 Three.js 对象、节点实例或 GPU 资源。`source` 只记录 `gpu`、`bvh` 或 `cpu` 等稳定枚举。
- 拾取结果不携带 `VoxelValue` 快照；调用方需要颜色/可见性时通过对应对象的 `VoxelReadView` 查询。

**依赖**：scene-types、voxel-types、util/math、util/packed-int。
