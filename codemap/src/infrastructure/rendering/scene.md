# scene.ts

**职责**：拥有 Three.js 渲染场景图、环境光照、直接光、HDRI 环境、辅助对象和渲染环境状态；它是 `SceneSnapshot` 的渲染适配器，不拥有领域场景，也不负责项目文件读写。
**接口**：
- `root`、`lights`、`environment`、`background`、`helpers`。
- `applyEnvironment(settings)`、`setEnvironmentMap(source | mapId)`、`setEnvironmentIntensity(value)`、`setBackground(settings)`。
- `applyLighting(settings)`、`setDirectionalLight({ color, intensity, position, target })`。
- `setPlane({ size, color, y })`、`setGrid`、`setHelpers`、`attach`、`detach`、`dispose`。
- `syncScene(sceneSnapshot)`、`applyScenePatch(patch)`、`setNodeWorldTransform(nodeId, matrix)`、`setObjectRenderable(objectId, visible)`。
- `captureRuntimeState()`、`restoreRuntimeState(state)`，仅用于 context lost、截图和渲染模式切换，不用于项目序列化。

**内部**：
- 每个领域 `SceneNode` 对应一个 Three.js `Object3D`；每个 `VoxObject` 的实例渲染挂在其绑定节点的子树下。节点变换由领域变换同步，渲染层不得反向修改 SceneDocument。
- `SceneNode.visible` 与对象体素 `visible` 的有效可见性分别影响节点子树和实例 mask；渲染层不得把“不可编辑”当成隐藏处理。
- 场景采用右手坐标系，保持与体素网格、相机和导入/导出坐标约定一致。编辑器灯光、地面、阴影接收面和辅助对象均在此创建。
- HDRI 以等距柱状反射贴图加载，设置 `EquirectangularReflectionMapping` 和线性过滤；默认环境贴图与自定义 `.hdr` 文件二选一。自定义文件内容属于运行时资源，不写入项目 JSON；可持久化的只有 `mapId` 等工作区偏好。
- 环境强度默认 `0.65`，可调范围至少覆盖 `0.01` 以上；HDRI 背景默认关闭，开启时背景强度为 `0.8`，模糊度默认 `0.05`。背景关闭时使用透明清屏，不把 HDRI 环境误当成 UI 背景色。
- 直接光默认颜色 `#FFE484`、强度 `0.8`，目标是当前场景有效对象包围盒中心；编辑器和 Sandbox 使用同一方向/颜色/强度快照。环境、灯光、材质变化后必须通知 `path-tracer` 重置累积采样。
- 地面平面默认关闭（尺寸 `0`）、颜色 `#90A0B3`；开启时位于当前场景有效对象的世界包围盒最低 Y 下方 `0.5`，仅用于渲染展示，不改变体素或对象边界。
- `captureRuntimeState/restoreRuntimeState` 只保存 GPU/场景资源可重建的引用和参数；恢复时重新创建纹理、灯光和 helper，不能复用 context lost 前的 GPU 对象。
- tone mapping 属于 `three-renderer`，后处理属于 `post-pipeline`；场景模块只提供环境和光照参数，避免形成多个渲染设置所有者。

**依赖**：three、domain/scene/scene-types、domain/scene/scene-patch、domain/render 设置类型、util/color、util/math。
