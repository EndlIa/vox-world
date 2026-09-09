# dom-contract.ts

**职责**：集中声明 HTML/CSS 的稳定 ID、class、CSS token、面板映射和隐藏 file input 契约。
**接口**：ids、classes、cssTokens、panels、fileInputs、selectors、validate(root)、panelForToolbarButton(button)、readToken(name)。
**内部**：只包含 DOM 常量、选择器和结构校验；不绑定事件、不访问应用状态，也不解析文件内容。
**依赖**：DOM 类型。

## HTML/CSS 单一事实源

- `index.html` 是结构和设计 token 的单一事实源；CSS 变量定义在 `:root`。
- TS 不得用整块 `innerHTML` 重建结构性 UI；动态列表使用受控节点和稳定 key。
- 可见文案可以变化，但语义 ID/class 保持稳定；改 ID/class 前必须搜索所有 selector 和控制器。
- 控件标签应短且不换行，例如统一使用 `Bypass Rect`，不要使用会撑坏布局的 `Bypass Add/Remove`。

## ID 约定

- `toolbar_btn_<key>`：面板恢复入口。
- `menu-<key>`：普通浮动菜单面板；`camera-animation-panel` 是动画面板的稳定例外。
- `btn_action_*`：一次性动作或命令。
- `btn_tool_*`：工具选择。
- `input-*`：面板内数值、文本、颜色、复选框等控件。
- `pref_*`：偏好设置；其持久化由 runtime preferences 处理，UI 只读/写值并发出动作。
- `openfile_*`：隐藏 file input；只能由对应触发器打开。
- `btn-*`：已有语义控件保留既有 ID，不为统一命名批量重命名。

## 结构根节点

以下节点及其角色是 UI 控制器的稳定契约：

| ID/selector | 角色 |
| --- | --- |
| `#menus` | 浮动菜单和面板总容器 |
| `#toolbar` | 左侧工具箱/面板恢复按钮 |
| `#toolbar-screen-top-mode` | model/render/export 模式栏 |
| `#toolbar-screen-top-mem` | 顶部快捷按钮 |
| `#toolbar-screen-storage` | model 模式 storage 快捷区 |
| `#toolbar-screen-material` | 当前颜色/材质快捷区 |
| `#toolbar-screen-render` | render 快捷区 |
| `#toolbar-screen-export` | export 快捷区 |
| `#toolbar-screen-toggles` | 平面、symmetry、投影等开关 |
| `#hover` | DOM hover 浮层 |
| `#palette` / `#canvas_palette` | 调色板容器与 canvas |
| `#meshlist` | 已烘焙 mesh 列表 |
| `#mesh-transform` | mesh 变换输入区 |
| `#color-picker` | 颜色选择器 |
| `#confirm` / `#confirmblocker` | 滑动确认框与 blocker |
| `#notifier` | 单槽通知 |
| `#options_screen` | Object/Edit 模式、对象放置和 Workplanes 等场景选项 |
| `#marquee` | 矩形选择框 |
| `#progressbar` | 长任务进度条 |
| `#info` / `#info_render` / `#info_tool` | 状态信息 |

## 面板映射

普通面板遵循 `toolbar_btn_<key>` -> `menu-<key>`：

| key | 面板 | 模式 |
| --- | --- | --- |
| `about` | `#menu-about` | all |
| `prefs` | `#menu-prefs` | all |
| `file` | `#menu-file` | model |
| `storage` | `#menu-storage` | model |
| `camera` | `#menu-camera` | model |
| `render` | `#menu-render` | render |
| `create` | `#menu-create` | model |
| `voxelize` | `#menu-voxelize` | model |
| `symm` | `#menu-symm` | model |
| `draw` | `#menu-draw` | model |
| `paint` | `#menu-paint` | model |
| `xform` | `#menu-xform` | model |
| `groups` | `#menu-groups` | model |
| `bakery` | `#menu-bakery` | model |
| `pbr` | `#menu-pbr` | render |
| `export` | `#menu-export` | export |
| `animation` | `#camera-animation-panel` | model |

Trellis 面板及其 mask 控件不在本次契约设计范围内。

## 稳定 class

| class | 契约 |
| --- | --- |
| `.panel` | 可注册的浮动面板 |
| `.menu` | 菜单型面板 |
| `.row_panel` | 面板标题/拖拽栏 |
| `.row`, `.row_input`, `.row_color` | 表单行布局 |
| `.tool` | 工具按钮 |
| `.tool_selector` | 当前工具选中态 |
| `.segment_selector` | 分段按钮选中态 |
| `.mode_select` | 当前 Editor 模式（object/edit）；不得与 workspace mode 复用 |
| `.panel_select` | 当前面板已打开 |
| `.ignorekeys` | 文本/数值输入，全局快捷键必须忽略 |
| `.help` | 可折叠帮助文本 |
| `.demo-mode` | 演示模式根标记 |

新增可编程行为优先使用 `data-action`、`data-tool-id`、`data-panel-key`、`data-field`，不要让选择器依赖可见文案。

## CSS token

`:root` 至少保留以下 token；UI 控制器通过 `readToken()` 读取，禁止散落硬编码颜色和尺寸：

```text
--font --font-size --col-white --intro --scene --border-radius --border
--menu-bg --menu-shadow --menu-btn-height --btn-height --btn-bg --btn-color
--btn-tool-border --btn-confirm-border --input-bg --input-color --input-height
--label --label-info --label-help --cat-bg --cat-color --cat-border
--text-shadow --tool-color-hover --colorpicker-bg --notifier-bg
--notifier-color --confirm
```

- 半透明 token 使用固定 8 位 hex；运行时 opacity 调整必须保留 alpha 格式。
- UI 视觉状态（禁用、选中、警告、错误）只能通过 token/class 表达，不内联散落颜色。
- z-index 分层固定为：画布 0、场景浮层 300、普通屏幕 UI 500、浮动面板 1000–2000、颜色选择器 2500、确认/通知覆盖层更高。

## 隐藏 file input 契约

这些 input 只描述 DOM 接受范围。选择后的解析、导入、体素化和格式校验属于 application/infrastructure，不在本模块实现。

| ID | accept | multiple |
| --- | --- | --- |
| `openfile_json` | `.json,.vbx` | 否 |
| `openfile_import_voxels` | `.json` | 否 |
| `openfile_vox` | `.vox` | 否 |
| `openfile_voxelizer` | `.obj,.mtl,.glb,.stl,.ply,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tga` | 是 |
| `openfile_voxel_mesh` | `.obj,.mtl,.glb,.stl,.ply,.schem,.schematic,.litematic,.mcstructure,.nbt,.npy,.npz,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tga` | 是 |
| `openfile_voxelizer_img` | `.jpg,.png,.svg` | 否 |
| `openfile_hdr` | `.hdr` | 否 |
| `openfile_baked_glb` | `.glb` | 否 |
| `openfile_snapshot_zip` | `.zip` | 否 |

- 触发器、accept、multiple 和帮助文案必须同步；修改一处必须更新本表。
- input 保持隐藏但不可使用 `display:none` 以外的语义破坏方式，必须保留 `type="file"` 和可编程 `click()`。
- `change` 处理完成后把 `value` 清空；同一个文件再次选择也必须触发。
- 多文件输入必须把完整 `FileList` 作为一个 action payload 发送，不能只保留第一个文件。
- Trellis2 图片输入不在本契约中设计。

## 校验

`validate(root)` 必须检查：

- 必需 ID 存在且全局唯一。
- 面板 key 与 toolbar 按钮一一对应，动画面板例外正确映射。
- 所有 `openfile_*` 的 accept/multiple 与注册表一致。
- 所有 `label[for]` 指向存在的控件。
- CSS token 可从 `:root` 读取。
