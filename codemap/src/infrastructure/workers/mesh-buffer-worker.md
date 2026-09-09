# mesh-buffer-worker.ts

**职责**：把单个对象或已变换的场景对象体素展开为导出和 BVH 使用的网格缓冲。
**接口**：fillMeshBuffers(snapshot, options)。
**内部**：生成 positions、normals、uvs、colors、indices；支持 transferable。对象局部任务由调用方传入世界变换，Worker 不读取 SceneDocument。
**依赖**：worker-protocol、scene-types。
