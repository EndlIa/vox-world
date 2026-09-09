# keyboard-router.ts

**职责**：把键盘事件转换为稳定的编辑器意图，维护修饰键/临时模式，并按焦点、modal 和平台规则过滤全局快捷键。
**接口**：attach(options: KeyboardRouterOptions): KeyboardRouterHandle；detach()；setContext(context)；register(shortcut)；activeModifiers()；cancelTransientKeys(reason)；isEditingTarget(target)；handleShortcut(id, event)。
**内部**：只读取 DOM 事件和只读输入上下文；把快捷键映射为 `ui/actions` 的纯意图或注入的 application input port，不直接调用工具、相机、History、DOM 控件或状态对象。
**依赖**：DOM Keyboard Events、ui/actions、application/editor-session 输入端口、application/tools/tool、util/platform。

## 上下文与事件规范化

```ts
type KeyboardContext = {
  editorMode: 'object' | 'edit';
  workspaceMode: 'model' | 'render' | 'export';
  activeObjectId?: string;
  selectedObjectId?: string;
  activeToolId?: string;
  objectTransformActive: boolean;
  voxelTransformActive: boolean;
  selectionKind?: 'object' | 'voxel';
  modal: 'none' | 'color-picker' | 'confirm' | 'dialog';
  inspectorOpen: boolean;
  editingSuspended: boolean;
};

type Shortcut = {
  id: string;
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  repeat?: boolean;
  when: (context: KeyboardContext) => boolean;
  action: ShortcutAction;
};
```

- 使用 `event.key` 和标准修饰键字段，不使用已废弃的 `keyCode`；字母统一转小写，但保留 `Escape`、`Enter`、`Delete` 等标准名称。
- `event.isComposing` 或 `event.keyCode === 229` 时忽略输入法组合事件；不得在组合过程中执行工具或历史动作。
- 命中快捷键后才调用 `preventDefault()`；未被消费的按键必须保留浏览器默认行为。
- `keydown` 与 `keyup` 必须成对处理修饰键和临时模式；窗口 blur、visibilitychange、detach 和上下文切换都要清理未释放的修饰键。

## 焦点过滤

以下目标不得接收全局编辑快捷键，事件应继续由控件处理：

- `input`、`textarea`、`select`、`[contenteditable="true"]`、`[role="textbox"]` 和带 `.ignorekeys` 的元素。
- 正在编辑的 inline rename 输入；其 click/dblclick/keydown/keyup 必须由控件层 `stopPropagation`，router 也要在焦点过滤层再次兜底。
- `button` 聚焦时的 Enter：不得触发 Transform Apply 或重复提交按钮动作。
- 颜色选择器、确认框、普通 modal 或其他 `aria-modal="true"` 层打开时，只允许该层声明的 Enter/Escape/方向键；全局工具、相机、历史和模式快捷键暂停。
- 命中文本选择、拖拽中的输入或 `event.defaultPrevented === true` 时不得再发送 action。

`isEditingTarget(target)` 是唯一的焦点判定入口。内联重命名、数值输入、颜色 HEX/RGB 输入和搜索框都必须复用该判定，不能各自维护不一致的 selector。

## 快捷键表

下表是必须迁移的 shithill 用户契约；`MODEL` 表示仅在建模模式生效：

| 快捷键 | 语义 | 动作边界 |
| --- | --- | --- |
| Space / Alt（按住） | 临时 Free Camera | `tool.select(camera, { temporary: true })`，释放后恢复原工具 |
| Enter | Apply 当前 XFORM | Object 模式应用 ObjectTransformSession；Edit 模式应用活动对象的 VoxelTransformSession；按钮聚焦时忽略 |
| Ctrl（按住） | 相机平移修饰键 | 向导航输入端口发布 `camera.navigate` 的 modifier 状态，不直接改相机 |
| Shift（按住） | Clone Transform / 修饰模式 | 记录到修饰键快照；工具在 pointerdown 时读取，不在手势中改变 |
| Delete | 删除选中对象或活动对象体素 | `selection.delete()`，由应用层按 `editorMode` 解析 |
| `` ` `` / C | Free Camera 工具 | `tool.select('camera')` |
| F | Frame 相机/当前选择 | 按上下文发送 `camera.frame(target)` |
| O | 切换正交/透视 | `camera.setProjection('toggle')` |
| R | 切换 Render 模式 | `panel.setMode('render')` |
| S | 切换对称轴 | `symmetry.nextAxis()` |
| T | 当前模式变换工具 | Object 模式选择对象变换；Edit 模式选择体素 Transform Box |
| 1 | Add | 仅 Edit 模式 `tool.select('add')` |
| 2 | Remove | `tool.select('remove')` |
| 3 | Box Add | `tool.select('box-add')` |
| 4 | Box Remove | `tool.select('box-remove')` |
| 5 | Paint | `tool.select('paint')` |
| 6 | Box Paint | `tool.select('box-paint')` |
| 7 | Bucket Group | `tool.select('bucket-group')` |
| 8 | Eyedropper | `tool.select('eyedropper')` |
| Ctrl+Z | Undo | `history.undo()` |
| Ctrl+X | Redo | `history.redo()`；这是 shithill 的既有非标准映射，不得擅自改成 Ctrl+Shift+Z |
| Ctrl+/ | 切换 Inspector | `debug.toggleInspector()` |
| Escape | 取消 XFORM / modal | 优先取消颜色选择器或确认框，其次取消当前模式的 TransformSession |

- 工具 id 必须来自 ToolRegistry；表中名称是语义别名，落地时以稳定 id 为准，不能按可见文案查找按钮。
- 不在表中新增会与浏览器、输入法或操作系统冲突的全局快捷键；平台别名只能作为显式配置，不能悄悄改变 Ctrl+X=Redo 的迁移契约。
- `Ctrl+Z/X` 在 workspace `MODEL` 下生效；其他工作区不得把历史快捷键发送给不可用的 History。
- `F` 在 Object 模式 Frame 选中对象，在 Edit 模式优先 Frame 活动对象/体素选择，在 Render/Export 中优先 Frame mesh；具体目标由 `KeyboardContext.selectionKind` 决定。
- `R` 切换的是 `workspaceMode`，不是 `editorMode`；Object/Edit 切换只能通过显式 UI action，不能与 Render 快捷键复用。
- Object 模式只能触发对象选择/变换/可见性工具；Edit 模式只能触发活动对象的体素工具。模式不匹配的快捷键必须忽略，不得由 router 自动切换模式。

## 修饰键与临时模式

- `activeModifiers()` 返回当前按键状态快照；工具在 pointerdown 时读取并冻结，避免手势中途 Shift/Ctrl 改变语义。
- Space/Alt 按下时先记录 `baseToolId` 和当前工具来源；重复 keydown 不重复切换。释放任一键时只有在工具仍处于临时 camera 且用户没有显式选择新工具时才恢复 `baseToolId`。
- 临时相机期间 `editingSuspended = true`，pointer-router 不接受新的编辑手势；释放后解除挂起并恢复原工具或保留用户显式选择。
- `Ctrl` 作为相机平移修饰键时，只更新导航输入端口的状态；pointer/gizmo 路由负责实际导航，keyboard router 不直接操作 camera 对象。
- `Shift` 用于 Clone 时由工具读取修饰键快照；keyup 只清除状态，不得在已有 Transform 会话中隐式改变模式。
- `Escape` 的优先级为：取消颜色选择器 -> 取消确认框 -> 取消 inline rename -> 取消 Transform -> 收起临时层；每一层只消费一次并阻止传播。
- 窗口失焦、visibilitychange、detach 和 modal 打开时必须释放 Space/Alt/Ctrl/Shift 的临时状态，避免键盘状态粘滞。

## 重复、冲突与平台差异

- 默认忽略 `event.repeat`；只有明确声明 `repeat: true` 的命令（如未来的连续微调）才能重复执行。Undo/Redo、Apply、Delete、工具切换和模式切换均不得重复提交。
- `event.metaKey` 与 `event.ctrlKey` 分开处理；shithill 的 Ctrl 映射保持 `ctrlKey` 语义，不因 macOS 自动替换为 Command。若增加平台别名，必须由偏好/平台适配器显式启用。
- 输入法、浏览器快捷键、系统快捷键和页面滚动优先于未被消费的按键；例如 Ctrl+L、Ctrl+R、F5 不因本模块存在而拦截。
- 快捷键注册表必须在 attach 时校验重复 key+modifier 组合；重复注册返回可诊断错误并保留原绑定。
- `handleShortcut(id, event)` 只接受注册表内的 id；未知命令不得猜测工具或直接调用状态机。

## 生命周期与验证

- `detach()` 移除 keydown/keyup/blur/visibilitychange 监听，清理注册表和临时修饰状态；重复 detach 幂等。
- `cancelTransientKeys(reason)` 用于 modal 打开、窗口失焦、模式切换和 UI 卸载，必须释放所有临时工具/修饰状态并取消未提交的 Transform 意图。
- 必须验证：输入框内 1–8/T/F/O/R/S 不切换工具；按钮聚焦 Enter 不 Apply；Ctrl+Z/Ctrl+X 分别 Undo/Redo；Space/Alt 释放后恢复原工具；modal 打开时全局快捷键暂停；失焦后没有残留 Ctrl/Shift 状态。
