# mesh-buffer-worker.ts

**职责**：把体素展开为导出和 BVH 使用的网格缓冲。
**接口**：fillMeshBuffers(snapshot, options)。
**内部**：生成 positions、normals、uvs、colors、indices；支持 transferable。
**依赖**：worker-protocol。
