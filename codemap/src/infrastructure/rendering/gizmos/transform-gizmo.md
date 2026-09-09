# transform-gizmo.ts

**职责**：将 Three.js 变换手柄包装成只发出意图的适配层，供 Object XFORM、Voxel XFORM 和相机控制使用；不直接提交命令或修改状态。
**接口**：
- `attach(target, mode)`、`detach`、`setMode(mode)`、`setSnap`、`snapshot`、`events`、`dispose`。
- `setScaleAwareness(enabled)`、`getAttachmentPolicy()`。
- 事件只提供 `{ phase: 'start'|'change'|'end', mode, delta, worldMatrix }`，由调用方转换为命令或运行时姿态。

**内部**：
- Object 模式将手柄附着到选中 `VoxObject` 绑定的 `SceneNode` 世界代理上，输出节点局部/父空间变换意图；Edit 模式只附着活动对象的体素 XFORM 预览代理，不得附着非活动对象。
- 包装 `TransformControls` 或自定义手柄，维护唯一活动 target，避免多个 XFORM/相机控制同时占用。
- **非均匀缩放 Rotation Gizmo 规则是必需功能**：当 target 的 scale 三轴不完全相等时，旋转手柄不得跟随 target 的旋转矩阵显示；设置 `updateGizmoRotationToMatchAttachedMesh = false`，使旋转轴保持世界/控制层稳定。位置和缩放手柄仍可按各自语义匹配 target，除非有明确例外。
- 手柄拖动开始/结束负责暂停 OrbitControls，结束或取消时必须恢复原控制权；不在此模块调用命令总线。
- 对 Object XFORM 只发出临时 SceneTransform 意图，由 ObjectTransformSession/Handler 决定预览、冲突和提交；对 Voxel XFORM 只发出活动对象的局部变换意图，由 VoxelTransformSession/Handler 处理；对 CameraControl 只更新运行时姿态，不自动写入关键帧。
- context lost、目标销毁或模式切换必须解绑事件和释放 helper；不保留跨上下文 GPU 句柄。

**依赖**：three、state/object-selection、state/voxel-selection、state/object-transform-session、state/voxel-transform-session、scene-types。
