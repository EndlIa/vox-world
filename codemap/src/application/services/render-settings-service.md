# render-settings-service.ts

**职责**：作为相机、PBR、环境、灯光、tonemap、PathTracer 和后处理设置的唯一规范化与持久化映射边界；把项目 JSON、工作区偏好和运行时默认值转换为只读 `RenderSettings`，再分发给编辑器 renderer、scene、Sandbox、PathTracer 和离线输出。它不直接持有 Three.js 对象，不读写 localStorage，也不实现项目编解码。

**接口**：
- `registerTarget(target: RenderSettingsTarget)`、`unregisterTarget(target)`。
- `getSnapshot(): Readonly<RenderSettings>`、`subscribe(listener): Unsubscribe`。
- `update(patch): Result<RenderSettings>`、`resetSection(section)`、`validate(patch)`。
- `normalizeProjectSettings(projectCamera, projectRender): Result<{ camera: ProjectCameraSettings; render: ProjectRenderSettings }>`、`applyProjectSettings(normalizedSettings): Result<void>`、`toProjectSettings(): { camera: ProjectCameraSettings; render: ProjectRenderSettings }`。
- `applyPreferences(preferenceSnapshot)`、`toPreferencePatch()`。
- `resolveEnvironmentMap(mapId)`、`setEnvironmentMapSource(mapId, runtimeSource?)`。
- 能力查询：`getToneMapping(id)`、`getPostProcessing()`、`getPathTracerSettings()`、`getMaterialSettings()`。
- 事件：`onChange({ section, settings, reason })`，只发出纯数据。

**内部**：保存唯一的规范化 `RenderSettings` 快照和按能力注册的 `RenderSettingsTarget` 集合；负责默认值合并、字段校验、项目/偏好映射、版本化通知和运行时资源句柄解析。它不拥有 Three.js 对象，不直接读写持久化，也不实现项目编解码或渲染逻辑。

**默认值与规范化**：
- 相机：`offset = 1.7`、`fov = 0.8` 弧度、`fStop = 1.4`、`focalLength = 25`。FOV 必须大于 `0`；offset、F-Stop 和 focal 按有限非负数校验，非法值回退默认并报告。
- PathTracer/Sandbox：`renderScale = 0.8`、`samples = 512`、`bounces = 1`、`tiles = 4`。`renderScale` 限制在 `0.1..1`，`samples` 为 `>= 8` 的整数，`bounces >= 1`，`tiles >= 1`。旧项目字段 `render.dpr` 映射为 `renderScale`。
- Tonemap 的持久化值是索引，运行时值是稳定枚举：`0 none`、`1 linear`、`2 reinhard`、`3 cineon`、`4 acesFilmic`、`5 agx`、`6 neutral`。未知索引回退 `none`，不得把 Three.js 常量写入项目。
- 环境：`background = false`、`environmentPower = 0.65`、`backgroundBlur = 0.05`、背景强度固定为 `0.8`。`power > 0`、`blur >= 0`；HDRI 使用 equirectangular reflection mapping 和线性过滤。
- 直接光：颜色 `#FFE484`、强度 `0.8`，目标为模型中心。颜色必须规范为不带 alpha 的 `#RRGGBB` 大写形式。
- 默认 PBR 材质：`roughness = 0.8`、`metalness = 0`、`transmission = 0`、`emissive = #5EC3C5`、`emissiveIntensity = 2`。材质构造的 `clearcoat = 0`、`specularIntensity = 1` 属于代码默认，不进入项目 JSON。
- 平面：尺寸 `0`（关闭）、颜色 `#90A0B3`。平面不是项目持久字段；编辑器显示值由工作区偏好/当前会话提供。
- 后处理：`effect` 为 `none|outline|ssao|custom`，默认 `none`；`samples` 默认 `4`，范围 `1..8`，移动端可降为 `2`。后处理属于工作区偏好，不属于项目 `render`。

**项目 JSON 契约**：
```json
{
  "camera": {
    "offset": 1.7,
    "fov": 0.8,
    "fstop": 1.4,
    "focal": 25
  },
  "render": {
    "dpr": 0.8,
    "samples": 512,
    "bounces": 1,
    "tiles": 4,
    "tonemap": 0,
    "environment": {
      "background": false,
      "power": 0.65,
      "blur": 0.05
    },
    "lights": {
      "directional": {
        "color": "#FFE484",
        "intensity": 0.8
      }
    },
    "materials": {
      "default": {
        "roughness": 0.8,
        "metalness": 0,
        "transmission": 0,
        "emissive": "#5EC3C5",
        "emissive_intensity": 2
      }
    }
  }
}
```
- `normalizeProjectSettings` 必须接受缺失或部分字段并逐字段回退默认值；旧项目缺少 `materials.default.emissive_intensity` 时使用 `2`。它必须先完成全部校验/规范化再返回，失败时不改变当前 `RenderSettings` 或任何 target，供 ProjectService 在替换会话前做原子预检。
- `applyProjectSettings` 只接受 `normalizeProjectSettings` 的输出，先提交唯一 `RenderSettings` 快照再按能力通知 targets；失败不得留下部分目标已更新的状态。`toProjectSettings` 只输出上述普通 JSON 字段，字段名保持 `fstop`、`focal`、`dpr`、`emissive_intensity`，不得输出运行时枚举、Three.js 对象、HDRI 二进制或 GPU 句柄。
- `project-codec` 只负责把 `toProjectSettings()` 结果和体素/动画组合进文档；它不解释 tonemap、PBR 或 PathTracer 规则。加载时先 decode 为普通数据，再调用本服务；保存时从本服务取普通数据，避免 UI 直接构造项目字段。

**偏好与运行时资源边界**：
- 工作区偏好只通过 `preferences` 端口读写：`pref_scene_postfx`、`pref_scene_postfx_samples`、`pref_background_check`、`pref_background_color`、`pref_render_shade`、`pref_voxel_texture`。HDRI 选择需要保存时使用独立的 `pref_scene_environment_map` 键并由 `preferences` 注册默认值/迁移；不得把 mapId 混入项目 `render`。
- 自定义 `.hdr` 文件只作为运行时 `Texture` 缓存；偏好中最多保存 mapId（例如 `default`、`black` 或工作区资源标识），文件内容和 object URL 不序列化。无法解析 mapId 时回退默认 HDRI 并报告。
- Sandbox `autoStart` 默认 `false`；若产品决定持久化，必须新增明确的 workspace preference，不得借用项目 `render` 字段。PathTracer 当前 sample、耗时、暂停状态、GPU render target、相机对象和后处理 attach 状态全部是运行时状态。

**更新与依赖边界**：
- `RenderSettingsTarget` 是能力端口集合而不是单一全量接口。目标按自身能力实现 `applyRendererSettings`、`applySceneSettings`、`applyMaterialSettings`、`applyCameraSettings`、`applyPathTracerSettings`、`applyPostProcessingSettings` 中需要的子集；服务按能力逐个分发，未实现的 section 不报错也不强制注入空方法。具体适配器由 composition root 注入，application 不 import infrastructure。
- 渲染状态所有权固定为：`three-renderer` 拥有 tonemap、renderer 尺寸和输出上下文；`scene` 拥有 HDRI、环境强度/模糊/背景、灯光和平面；`voxel-material` 拥有 PBR material 参数；`camera-controller` 拥有 projection、FOV、F-Stop 和 focal；`path-tracer` 拥有 samples、bounces、renderScale 和 tiles；`post-pipeline` 拥有 effect 与 samples。服务只保存规范化纯数据并调用能力端口，禁止任何目标反向修改 `RenderSettings` 快照。
- `update()` 先验证和规范化，再生成新的只读快照并一次性通知已注册目标；每个目标收到同一版本快照。PathTracer 收到会影响画面的设置后必须 `reset()` 采样；仅相机 FOV/F-Stop/Focal 变化时更新 camera，不重建材质。相机移动也不触发 renderer/scene/material 重建。
- 任一设置变化不得直接修改体素颜色或关键帧。环境、灯光、材质、tonemap 变化后必须使 PathTracer 累积采样失效；相机移动只更新 camera，不重建材质。
- 项目新建/打开/恢复/另存为时由 ProjectService 调用 `normalizeProjectSettings` 预检，再在项目会话提交后调用 `applyProjectSettings`；Snapshot 不携带 camera/render，恢复 Snapshot 时保留当前项目设置。context restore 以本服务的规范化快照为准，context lost 期间保留纯数据设置，恢复后重新应用。

**依赖**：domain/render 设置类型、project 的普通数据契约、preferences 端口、本文件定义的 `RenderSettingsTarget` 及 Renderer/Scene/Material/Camera/Sandbox/PathTracer/PostProcessing settings capability ports；具体基础设施适配器由 app composition root 注入。
