# camera-controller.ts

**职责**：拥有编辑器交互相机及其取景行为，包括轨道/平移/缩放、透视/正交切换、六面预设、Frame 操作、FOV、景深参数和自动旋转；不读取或修改体素数据。
**接口**：
- `attach`、`detach`、`orbit`、`pan`、`zoom`；`setProjection(projection)`、`toggleProjection()` 对应 UI 的 `Perspective` / `Orthographic`。
- `setView(view)`，`view` 为 `right|left|top|bottom|front|back`，对应 `Right`、`Left`、`Top`、`Bottom`、`Front`、`Back` 六面预设。
- `frameAll(bounds)`、`frameColor(hex, bounds)`、`frameVoxels(bounds)`、`frameIsland(bounds)`，分别对应 `Frame All`、`Frame Color`、`Frame Voxels`、`Frame Island`；边界由应用层从当前文档/选择集解析，控制器只负责取景。
- `setFov(radians)`、`setDof({ fStop, focalLength })`、`setAutoRotate({ enabled, counterClockwise })`；自动旋转的 `counterClockwise` 对应 `Auto Rotate` 开启后的 `CW` / `CCW`。
- `captureView()`、`applyView(view)`、`captureProjectSettings()`、`restoreProjectSettings(settings)`、`snapshot`。

**内部**：
- 使用 OrbitControls 或自定义控制器；限制 radius 和 beta，保持正交模式在俯视/仰视下的数值稳定。
- 透视与正交共享位置、目标和朝向。正交视锥按当前 radius/FOV 和 aspect 重新计算 `left/right/top/bottom`；切换投影不得改变当前取景中心。
- 六个预设固定为 Right、Left、Top、Bottom、Front、Back，分别对应 `+X/-X/+Y/-Y/+Z/-Z`；切换后目标保持模型/选区中心，并同步 Sandbox 相机。
- `frameAll` 使用模型包围盒；`frameColor`、`frameVoxels`、`frameIsland` 使用应用层提供的对应边界。取景偏移默认 `1.7`，以包围球半径、垂直 FOV 和 aspect 计算安全距离，目标 Y 取包围盒高度的 `40%` 位置；取景过程不得与导航手势并发。
- 默认 FOV 为 `0.8` 弧度，F-Stop 默认 `1.4`，Focal Length 默认 `25`。FOV 同时驱动编辑器相机；F-Stop/Focal 用于 Sandbox 的 PhysicalCamera/PathTracer，项目 `camera` 字段分别序列化为 `fov`、`fstop`、`focal` 和 `offset`。
- 自动旋转默认关闭，支持 CW/CCW；速度使用 `±0.1`，空闲等待和加速时间默认各 `1` 秒。自动旋转是相机行为，不写入动画关键帧。
- `captureView` 返回纯数据 `{ position, rotation, target?, fov, projection, orthoRect? }`，供 Camera Control、Follow/Observe 恢复和 Sandbox 同步使用；不得暴露 Three.js 对象。

**依赖**：three、util/math、domain/voxel/voxel-types。

## 本重构必须补齐

- 必须实现透视/正交切换、Right/Left/Top/Bottom/Front/Back 六面预设和 Frame All/Color/Voxels/Island。
- 必须实现 FOV、F-Stop、Focal Length 的项目设置映射与运行时应用，并保持透视/正交的位置、目标和朝向一致。
- 必须实现 Auto Rotate 的 CW/CCW、速度、空闲等待和加速语义；自动旋转不得写入相机动画关键帧。
- 取景操作必须与导航手势互斥，并在结束后同步 Sandbox 相机。
