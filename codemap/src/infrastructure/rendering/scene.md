# scene.ts

**职责**：拥有 Three.js 渲染场景图、环境光照、直接光、HDRI 环境、辅助对象和渲染环境状态；它是 `SceneSnapshot` 的渲染适配器，不拥有领域场景，也不负责项目文件读写。它同时保存节点 authored/base transform 与仅运行时存在的动画覆盖，并负责把两者合成为有效局部/世界变换。

**接口**：
- `root`、`lights`、`environment`、`background`、`helpers`。
- `applyEnvironment(settings)`、`setEnvironmentMap(source | mapId)`、`setEnvironmentIntensity(value)`、`setBackground(settings)`。
- `applyLighting(settings)`、`setDirectionalLight({ color, intensity, position, target })`。
- `setPlane({ size, color, y })`、`setGrid`、`setHelpers`、`attach`、`detach`、`dispose`。
- `syncScene(sceneSnapshot)`、`applyScenePatch(patch)`、`setNodeWorldTransform(nodeId, matrix)`、`setObjectRenderable(objectId, visible)`。
- `setNodeAnimationOverride(nodeId, transformPatch)`、`clearNodeAnimationOverrides()`；覆盖来自只读 `AnimationEvaluation.nodes` 中对应节点的 `Partial<SceneTransform>`。
- `captureRuntimeState()`、`restoreRuntimeState(state)`，仅用于 context lost、截图和渲染模式切换，不用于项目序列化。

**内部**：
- 每个领域 `SceneNode` 对应一个 Three.js `Object3D`；每个 `VoxObject` 的实例渲染挂在其绑定节点的子树下。`SceneNode.transform` 是 `SceneDocument` 中的 authored/base 局部变换；渲染层不得反向修改 `SceneDocument`。
- 每个节点维护 base local TRS 和可选的运行时动画覆盖。有效局部 TRS 按通道合成：有 `position`、`rotation` 或 `scale` 覆盖时替换对应通道，没有覆盖时使用 base 值；最终矩阵为 `T * R * S`。
- 世界矩阵必须按父子关系逐级组合 `parentEffectiveWorld * localEffective`。节点轨道只表达相对父节点的局部变换，不得把世界矩阵写进动画覆盖；父节点被动画驱动时，子节点自动继承其结果。
- `setNodeAnimationOverride` 替换指定节点的运行时覆盖并重算该节点及其子树；未知 `SceneNodeId`、根节点或非法 TRS 必须拒绝，不能静默跳过。应用一个 `AnimationEvaluation` 前由调用方校验全部节点目标，再按稳定顺序写入，保证相同 evaluation 重复应用得到相同矩阵。scene 不调用 `domain/animation.evaluateAnimation`，只消费已经求值并校验的覆盖。
- `clearNodeAnimationOverrides()` 幂等移除全部动画覆盖，恢复 authored/base transform 并重算世界矩阵。停止播放、项目加载/切换、项目新建和 dispose 必须经 `AnimationApplyPort.clearEvaluation()` 统一调用。
- `syncScene` 用新的 `SceneSnapshot` 替换 authored/base 场景并清除旧节点覆盖，防止项目切换后泄漏；`applyScenePatch` 只更新 base transform，同时保留当前覆盖并用有效矩阵重新计算层级。
- 节点覆盖是运行时状态，不得写入 `SceneDocument`、`AnimationDocument`、项目 JSON、History 或 `captureRuntimeState`。context lost 时必须先清除覆盖，再由 `captureRuntimeState/restoreRuntimeState` 只恢复 authored/base 场景资源。
- `SceneNode.visible` 与对象体素 `visible` 的有效可见性分别影响节点子树和实例 mask；动画只改变 TRS，不改变可见性，渲染层不得把“不可编辑”当成隐藏处理。
- 场景采用右手坐标系，保持与体素网格、相机和导入/导出坐标约定一致。编辑器灯光、地面、阴影接收面和辅助对象均在此创建。
- HDRI 以等距柱状反射贴图加载，设置 `EquirectangularReflectionMapping` 和线性过滤；默认环境贴图与自定义 `.hdr` 文件二选一。自定义文件内容属于运行时资源，不写入项目 JSON；可持久化的只有 `mapId` 等工作区偏好。
- 环境强度默认 `0.65`，可调范围至少覆盖 `0.01` 以上；HDRI 背景默认关闭，开启时背景强度为 `0.8`，模糊度默认 `0.05`。背景关闭时使用透明清屏，不把 HDRI 环境误当成 UI 背景色。
- 直接光默认颜色 `#FFE484`、强度 `0.8`，目标是当前场景有效对象包围盒中心；编辑器和 Sandbox 使用同一方向/颜色/强度快照。环境、灯光、材质变化后必须通知 `path-tracer` 重置累积采样。
- 地面平面默认关闭（尺寸 `0`）、颜色 `#90A0B3`；开启时位于当前场景有效对象的世界包围盒最低 Y 下方 `0.5`，仅用于渲染展示，不改变体素或对象边界。
- `captureRuntimeState/restoreRuntimeState` 只保存 GPU/场景资源可重建的引用和参数；恢复时重新创建纹理、灯光和 helper，不能复用 context lost 前的 GPU 对象。
- tone mapping 属于 `three-renderer`，后处理属于 `post-pipeline`；场景模块只提供环境和光照参数，避免形成多个渲染设置所有者。

**依赖**：three、domain/animation、domain/scene/scene-types、domain/scene/scene-patch、domain/render 设置类型、util/color、util/math。
