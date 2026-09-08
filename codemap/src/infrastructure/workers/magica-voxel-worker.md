# magica-voxel-worker.ts

**职责**：后台解析 MagicaVoxel 文件。
**接口**：parseMagicaVoxel(buffer)。
**内部**：解析体素、调色板和场景层级，转换为可传输的领域数据。
**依赖**：worker-protocol、magica-voxel-importer。
