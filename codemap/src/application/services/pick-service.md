# pick-service.ts

**职责**：把屏幕输入转换为领域拾取结果。
**接口**：pick、pickMany、setLayer、setMode。
**内部**：
- Object 模式只做对象级拾取，返回 `{ objectId, nodeId }`；不返回对象内部体素键。
- Edit 模式必须读取 `EditorState.activeObjectId`，只对活动对象注册/启用体素拾取，并把内部实例 ID 映射回 `{ objectId, voxelKey }`。
- 其他对象可以继续渲染，但必须被拾取过滤；PickService 返回任何非活动对象的体素结果都属于契约错误。
- 选择 GPU、BVH 或 CPU 拾取实现；处理面、邻接单元和对象世界变换。内部实现不得让渲染对象身份泄漏到领域层。
- `setLayer` 只用于渲染/拾取技术层分组，不能代替 `objectId` 过滤或 Edit 模式约束。

**依赖**：picker-port、pick-result、scene-types、editor-state、voxel-query、voxel-types。
