# preferences.ts

**职责**：读写只属于编辑器运行时的轻量用户偏好，并在启动时提供带默认值校验的强类型快照。

**接口**：`load()`、`get(key)`、`set(key, value)`、`reset()`、`subscribe(listener)`、`toPersistenceSnapshot()`。

**必须承接的 localStorage 键**：
`pref_minimal`、`pref_user_startup`、`pref_toolbar_icons`、`pref_fps_max`、`pref_startbox_size`、`pref_palette_size`、`pref_snapshot_num`、`pref_help_labels`、`pref_ignore_confirms`、`pref_glass_ui`、`pref_ui_opacity`、`pref_background_check`、`pref_background_color`、`pref_render_shade`、`pref_voxel_texture`、`pref_scene_postfx`、`pref_scene_postfx_samples`、`pref_scene_pointcloud`。

**内部**：
- 每个键有明确默认值、类型和允许范围；键缺失时使用默认值，损坏值时回退并报告，不得让启动失败。偏好模块只读取当前键名和当前类型，不承担项目持久化。
- `pref_user_startup` 在 hosted 模式强制禁用；`debug.clearLocalStorage` 在读取前清空，仅用于本地诊断。
- 写入必须同步反映到运行中的服务；失败不得伪报成功。项目、快照、bake mesh 和大型二进制数据不得进入此模块。
- `appid` 由 runtime-config 管理，不作为 UI 偏好。

**边界**：不承担项目持久化、snapshot、autosave 或 repository 逻辑；这些由 persistence/application 层负责。

**依赖**：runtime-config、platform-port。
