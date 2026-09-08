# octree.ts

**职责**：体素坐标的稀疏空间索引。
**接口**：insert、remove、update、queryBox、rayCandidates、rebuild、clear。
**内部**：支持增量更新和批量重建；只返回体素键；不依赖 Three.js。
**依赖**：util/math。
