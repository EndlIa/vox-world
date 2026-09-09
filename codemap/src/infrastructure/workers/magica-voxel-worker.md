# magica-voxel-worker.ts

**职责**：后台解析 MagicaVoxel 文件。
**接口**：parseMagicaVoxel(buffer)。
**内部**：解析体素、调色板和场景层级，转换为可传输的局部 `VoxObject` 快照和节点放置数据；不直接创建 SceneDocument。
**依赖**：worker-protocol、scene-types、magica-voxel-importer。
