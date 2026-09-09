# ui-root.ts

**职责**：挂载整套 DOM UI，建立 view model 订阅、动作分发和所有 UI 控制器的作用域。
**接口**：mount(rootElement, viewModel, actions): UiHandle；unmount(handle)；flush()；dispose()。
**内部**：先校验 DOM 契约，再创建 PanelManager、Controls、PalettePanel、HoverOverlay 和 Bindings；只持有 UI 控制器及 DOM 生命周期，不访问 Three.js、SceneDocument、EditorState、Object/Voxel Selection、TransformSession 或其他可变领域对象。
**依赖**：ui/dom-contract、ui/panels、ui/controls、ui/palette-panel、ui/hover-overlay、ui/bindings、ui/editor-view-model、ui/actions。

## 挂载契约

`ui-root.ts` 是 UI 的唯一 composition point。`mount` 必须完成以下顺序：

1. 通过 `dom-contract.ts` 验证必需节点、ID、面板映射和 CSS token；缺失或重复 ID 时立即抛出可诊断错误。
2. 创建 `PanelManager`，注册静态 `.panel` 与 `.menu.panel`，并绑定 `#toolbar_btn_*` 的恢复入口。
3. 创建 `Controls`，注册颜色选择器、确认滑动条、通知、数值/文本/选择/复选控件。
4. 创建 `PalettePanel` 和 `HoverOverlay`，二者只消费 view model 并发出 actions。
5. 创建 `Bindings`，集中注册事件委托、view model 订阅、文件输入 change 处理和 DOM 批量更新调度。
6. 首次 `sync` 必须在一次 `requestAnimationFrame` 中完成，避免挂载期间交错读写布局。
7. 返回 `UiHandle`，其中至少包含 `root`、`flush`、`unmount` 和 `dispose`。

## 状态所有权

- 应用状态只通过 `EditorViewModel` 的只读快照进入 UI。
- 面板位置、z-order、最小化、关闭、拖拽、hover 展开状态和控件焦点属于 UI 局部状态，由对应控制器拥有，不写回领域状态。
- 颜色值、工具选择、相机动画、项目、导出设置等通过 `actions` 发送类型化意图。
- UI 不缓存可变领域对象；需要展示的数据必须已在 view model 中投影为稳定值。

## 生命周期与清理

- 每次 `mount` 创建一个 `AbortController`，所有 DOM 监听、ResizeObserver、MutationObserver 和订阅都绑定到该 scope。
- `unmount` 必须按反序执行：停止订阅/动画帧 -> 关闭模态层 -> 释放 pointer capture -> 销毁子控制器 -> 清空局部事件 -> 移除临时节点。
- `dispose` 必须幂等；重复调用不得再次移除节点或再次释放资源。
- 页面 `visibilitychange`、窗口失焦和组件卸载时，UI 必须关闭颜色选择器/确认层，取消 hover 拖拽，释放 capture，并清除通知计时器。
- 挂载失败时，已创建的子控制器必须回滚，不得留下全局监听器。

## DOM 与无障碍

- 结构性节点以 `index.html` 为唯一来源，不在 TS 中拼接整块 `innerHTML`。
- 所有交互控件必须有可访问名称；图标按钮同时提供 `title` 和 `aria-label`。
- 面板打开、颜色选择器打开和确认框打开时执行焦点进入；关闭后恢复到触发控件。
- 模态层使用 `role="dialog"` 或 `role="alertdialog"`、`aria-modal="true"`，并在打开期间阻止全局编辑快捷键。
- 动态通知使用 `aria-live="polite"`；错误可使用 `role="alert"`。

## 验证重点

- 任意面板关闭、最小化后都能从对应 toolbar 按钮重新打开。
- 切换 model/render/export 模式时，不相关面板和悬浮层按面板契约隐藏，且不会残留 capture。
- UI 卸载后不存在全局键盘/指针监听、动画帧、计时器或 observer。
