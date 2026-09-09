# overlays.ts

**职责**：渲染对象/体素选择、悬停、工具预览、工作平面、辅助线和相机控制显示层；覆盖层是运行时可视状态，不得写入 `SceneDocument`。
**接口**：
- `setSelection`、`setHover`、`setPreview`、`setWorkplane`、`clear`、`dispose`。
- `setPlaybackProxy(visible, state)`、`clearPlaybackProxy()`，供相机动画 observe 模式显示临时姿态。
- `suspendForCapture(kinds?)`、`restoreAfterCapture()`。

**内部**：
- Object Selection 高亮绑定对象的世界包围盒/节点；Voxel Selection 高亮只属于 `activeObjectId`，并携带对象身份以防对象切换后残留。
- 工具 ghost 使用单一共享实例层并关闭实例拾取；选择/悬停/工作平面使用独立材质和层掩码，不能污染持久体素颜色。
- 持久半透明体素层由 `voxel-instances` 管理，工具 ghost 由本模块管理；两者不得复用材质或 `overlayAlpha` 路径。
- 连续体素预览只接收 `voxel-instances` 生成的外露壳几何，overlay 只负责高亮和生命周期，不重复生成半透明立方体。
- `suspendForCapture` 在截图和离线动画帧捕获时隐藏选择框、hover、gizmo、轨迹和临时 playback proxy；恢复时必须恢复原始可见性与选中状态，不能改变用户编辑状态。
- 所有临时对象必须可重复创建/销毁；WebGL context restore 后由 renderer 重新调用覆盖层重建。

**依赖**：three、renderer-port 定义的只读选择/预览 DTO、domain/scene/scene-types、domain/voxel/voxel-types。不得 import application/tools/tool-context 或其他具体用例模块。
