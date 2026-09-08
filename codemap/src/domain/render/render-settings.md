# render-settings.ts

**职责**：定义渲染设置的稳定纯数据类型、默认值、项目 JSON DTO、规范化与序列化规则。它只描述相机、Tonemap、环境、灯光、PBR 材质、PathTracer 和后处理参数，不持有 Three.js 对象、GPU 资源、DOM、偏好存储或项目会话。

**接口**：
- `createDefaultRenderSettings(): RenderSettings`、`createDefaultProjectSettings(): { camera: ProjectCameraSettings; render: ProjectRenderSettings }`。
- `normalizeRenderSettingsPatch(current, patch): Result<RenderSettings>`、`validateRenderSettings(settings): Result<RenderSettings>`、`cloneRenderSettings(settings): RenderSettings`。
- `normalizeProjectSettings(camera, render): Result<{ camera: ProjectCameraSettings; render: ProjectRenderSettings }>`、`toProjectSettings(settings): { camera: ProjectCameraSettings; render: ProjectRenderSettings }`。
- 分区类型：`CameraSettings`、`RendererSettings`、`EnvironmentSettings`、`LightingSettings`、`MaterialSettings`、`PathTracerSettings`、`PostProcessingSettings`。
- 项目 DTO：`ProjectCameraSettings`、`ProjectRenderSettings`、`ProjectEnvironmentSettings`、`ProjectLightingSettings`、`ProjectMaterialSettings`。
- 稳定枚举：`ToneMappingId = "none" | "linear" | "reinhard" | "cineon" | "acesFilmic" | "agx" | "neutral"`、`PostProcessingId = "none" | "outline" | "ssao" | "custom"`。

**内部**：
- `RenderSettings` 是不可变分区快照。运行时字段使用稳定枚举和普通数值，禁止出现 Three.js 常量、`Texture`、render target、camera、HDRI 二进制或文件句柄。
- `CameraSettings` 至少包含 `offset`、`fov`、`fStop`、`focalLength`；默认值分别为 `1.7`、`0.8` 弧度、`1.4`、`25`。`fov > 0`，其余字段必须是有限非负数，非法值回退默认并返回诊断。
- `RendererSettings` 保存 Tonemap 稳定枚举，默认 `none`；Three.js 常量到枚举的映射只存在于基础设施适配器。
- `EnvironmentSettings` 包含 `background`、`environmentPower`、`backgroundBlur`；默认 `false`、`0.65`、`0.05`。`power > 0`、`blur >= 0`；背景强度固定为 `0.8`，不作为可编辑项目字段。
- `LightingSettings` 包含直接光颜色和强度，默认 `#FFE484`、`0.8`；颜色必须规范为不带 alpha 的大写 `#RRGGBB`。
- `MaterialSettings` 包含默认 PBR 的 `roughness`、`metalness`、`transmission`、`emissive`、`emissiveIntensity`，默认分别为 `0.8`、`0`、`0`、`#5EC3C5`、`2`。`clearcoat = 0` 与 `specularIntensity = 1` 是材质构造默认，不属于项目设置。
- `PathTracerSettings` 包含 `renderScale`、`samples`、`bounces`、`tiles`，默认 `0.8`、`512`、`1`、`4`；`renderScale` 限制在 `0.1..1`，`samples` 是 `>= 8` 的整数，`bounces >= 1`，`tiles >= 1`。旧项目 `render.dpr` 必须映射到 `renderScale`，不能形成第二个所有者。
- `PostProcessingSettings` 包含 `effect` 与 `samples`，默认 `none`、`4`；`samples` 限制在 `1..8`，移动端允许降为 `2`。后处理属于工作区偏好，不属于项目 `camera`/`render` DTO。
- `ProjectCameraSettings` 固定使用 `offset`、`fov`、`fstop`、`focal` 字段名；`ProjectRenderSettings` 固定使用 `dpr`、`samples`、`bounces`、`tiles`、`tonemap`、`environment`、`lights`、`materials` 字段名，并保持 `emissive_intensity` 的下划线形式。Tonemap 项目值是索引，映射到运行时枚举；未知索引回退 `none`。
- `normalizeProjectSettings` 必须接受缺失、部分或 legacy 字段，逐字段回退默认值并一次性返回完整结果；任何失败都不得修改输入或生成半规范化对象。`toProjectSettings` 只输出可 JSON 序列化的项目字段，不得输出运行时枚举、Three.js 对象、HDRI 内容、GPU 句柄或工作区偏好。
- 所有规范化函数保持无副作用、确定性、可重复调用；不读取 localStorage、不依赖当前时间、不访问 DOM，也不缓存全局可变设置。

**依赖**：util/color、util/math、util/result。
