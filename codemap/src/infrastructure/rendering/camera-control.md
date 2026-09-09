# camera-control.ts

**职责**：提供仅运行时存在的“拍摄机位”编辑对象，供相机轨道作者以第三人称查看相机 body、视锥和 up 方向，并把姿态写入或取出相机轨道；它不是项目数据，不得序列化，也不承担时间轴插值或节点轨道编辑。

**接口**：
- 生命周期：`initialize(scene, deps)`、`clear()`、`dispose()`、`rebuildAfterContextRestore()`。
- 可见性与选择：`show()`、`hide()`、`select()`、`deselect()`、`isVisible()`、`isSelected()`。
- 姿态：`setState({ position, rotation, fov })`、`captureState()`、`setPosition`、`setRotation`、`setFov`、`captureEditorView()`、`applyToEditorView()`。
- Gizmo：`setGizmoMode('translate' | 'rotate')`、`toggleGizmoMode()`、`detachGizmo()`。
- 播放代理：`beginPlaybackPreview(cameraState)`、`applyPlaybackState(cameraState)`、`endPlaybackPreview()`。
- 路径显示：`showPath(points)`、`showKeyframeMarkers(keyframes)`、`hidePath()`、`hideKeyframeMarkers()`。
- 事件：`onStateChange(state)`，只报告普通可序列化姿态和选择/可见性，不暴露 Three.js 对象。

**内部**：
- 维护 `position`、单位四元数 `rotation` 和弧度 `fov` 三个运行时字段；创建相机 body、按 FOV/aspect 计算的线框视锥以及独立实心三角形 up 标记。视锥只表达取景，不参与拾取或最终渲染。
- 选中时由 `transform-gizmo` 提供唯一活动 target，位置/旋转模式通过单一切换按钮切换；拖动只更新运行时姿态并发出 `onStateChange`，绝不自动写入相机轨道关键帧。旋转 gizmo 在非均匀缩放 target 上保持世界/控制层轴稳定，沿用 `transform-gizmo` 的规则。
- `Camera -> View` 读取 `camera-controller.captureView()`，若 Camera Control 不存在则先创建，再把位置、四元数和 FOV 写入 control。`View -> Camera` 把现有 control 的纯数据姿态交给 `camera-controller.applyView()`。两条路径都不得修改已有相机轨道关键帧。
- `Add Keyframe` 只允许从当前 Camera Control 读取状态；没有 control 时返回不可用，不得回退到编辑器相机或最后选中的关键帧。实际写入必须经 `AnimationSessionPort.addCameraKeyframeFromControl()` 到 `AnimationDocument` 的相机轨道，本模块不直接修改文档，也不创建节点轨道。
- Observe Mode 使用临时播放姿态：保存作者态的位置、四元数、FOV、可见性和选择状态，只显示 authored/base camera 与 `AnimationEvaluation.camera` patch 合并后的完整 effective camera pose，不修改 control 的作者态；播放暂停/结束/取消、项目加载或切换时恢复作者态并清除播放代理。Follow 模式开始前必须 `hide()` 并 `deselect()`，结束后恢复原可见性和选择状态，但不得自动重新选中。
- 相机路径由白色 Line 绘制，点来自动画控制器按当前相机轨道采样后的位置；关键帧 marker 是朝活动相机 billboard 的空心圆，只在至少两个相机轨道关键帧时显示。路径和 marker 在离线渲染、截图和 Follow 播放中隐藏，恢复时不得改变用户原本的显示开关。
- `clear()` 在项目新建/加载、Storage/snapshot 恢复、项目切换和 dispose 时移除姿态、helper、gizmo、路径、播放代理和事件，保证运行时 control 不会泄漏到新项目。WebGL context restore 后只重建 helper 几何和材质，不改变运行时姿态。
- 本模块只负责相机轨道的作者态和相机覆盖显示；节点局部 TRS 覆盖由 `scene` 应用，统一求值由 `domain/animation.evaluateAnimation` 产生并经 `AnimationApplyPort` 提交，本模块不得缓存或改写 `SceneDocument`，也不得形成第二个播放求值入口。

**依赖**：three、application/ports/animation-port、camera-controller、gizmos/transform-gizmo、domain/animation、util/math。
