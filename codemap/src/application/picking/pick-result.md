# pick-result.ts

**职责**：跨拾取实现共享的稳定结果类型。
**接口**：voxelKey、point、normal、face、distance、layer、source。
**内部**：只包含可序列化的普通数据；不携带 Three.js 对象或 GPU 资源。
**依赖**：util/math、util/packed-int。
