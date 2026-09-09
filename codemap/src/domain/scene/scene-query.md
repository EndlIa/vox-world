# scene-query.ts

**职责**：提供场景层只读查询、世界变换解析、有效可见性和对象/节点映射。

**接口**：
- `getNode(scene, nodeId)`、`getObject(scene, objectId)`、`children(scene, nodeId)`、`parent(scene, nodeId)`。
- `objectForNode(scene, nodeId)`、`nodeForObject(scene, objectId)`。
- `localTransform(scene, nodeId)`、`worldTransform(scene, nodeId)`、`worldBounds(scene, objectId)`。
- `effectiveVisible(scene, nodeId)`、`objectVisible(scene, objectId)`。
- `objectVoxelReadView(scene, objectId)`。
- `validateScene(scene)`。

**内部**：
- 查询只读 `SceneSnapshot`，不创建或修改 `SceneDocument`，不依赖 Three.js。
- `worldTransform` 从根到目标节点依次组合父变换；结果只用于只读计算，不写回快照。
- `worldBounds` 先把对象局部占用包围盒转换为世界 AABB；空对象返回空 AABB。旋转或非均匀缩放后的结果必须是包含真实几何的世界轴对齐包围盒。
- `effectiveVisible` 返回节点自身及全部祖先的可见性逻辑与。隐藏节点不参与渲染，但对象和体素数据仍存在。
- `objectVoxelReadView` 返回只读视图，其坐标语义是该 `VoxObject` 的局部网格；不得把对象内部 `Map` 泄漏给调用方。
- 场景查询不负责屏幕拾取、相机视锥判断或渲染表面选择；这些由 PickService 和渲染层处理。
- `validateScene` 检查 `scene-types` 中的全部结构不变量，失败返回 `SceneValidationError`，不得自动修复输入。

**依赖**：scene-types、voxel-types、voxel-query、util/math、util/result。
