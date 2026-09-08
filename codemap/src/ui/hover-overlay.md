# hover-overlay.ts

**职责**：管理画布上的 DOM Hover 浮层，包括展开/收起、拖拽、离屏恢复和快捷工具入口。
**接口**：mount(root, viewModel, actions)；update(snapshot)；show()/hide()；reset()；dispose()。
**内部**：只渲染 view model 中的工具/相机快捷项；点击项发出 actions，不直接调用工具状态机或相机控制器。
**依赖**：ui/editor-view-model、ui/actions、ui/dom-contract、DOM Pointer Events。

## 结构与状态

- 使用 `#hover` 作为固定定位根，拖拽手柄与快捷项容器分离；结构在 HTML 中声明。
- 局部状态只包含：是否展开、位移 offset、拖拽中的 pointer id、初始坐标。
- 展开状态默认显示，可在双击拖拽手柄或 contextmenu 时切换；刷新/重建时使用默认展开状态。
- 浮层项目由 view model 过滤：不可用工具隐藏或禁用，不使用硬编码工具列表。

## 拖拽与 capture

- 只有拖拽手柄可以启动拖拽；快捷项按钮和图标上的 pointer 事件不得启动拖拽。
- pointerdown 时记录 pointer id、初始 client 坐标和当前 offset，调用 `setPointerCapture`。
- pointermove 只根据匹配的 pointer id 更新 `translate(x, y)`；pointerup 提交 offset。
- `pointercancel`、`lostpointercapture`、窗口 blur 和 `dispose` 必须释放 capture 并停止拖拽。
- 拖拽期间不得向画布发送编辑手势；如实现“拖拽时临时进入相机导航”，必须发出 `tool.select(camera, { temporary: true })`，并在结束时由应用层恢复原工具。
- 点击快捷项后关闭/收起浮层，焦点返回画布或最近的面板。

## 离屏与边界

- `reset()` 把 offset 归零并把浮层放回初始位置。
- resize 或 visibilitychange 后，如果浮层中心/保留边缘离开视口，自动 `reset()`。
- 展开后的项目不能超出视口；可在边界内翻转方向，但不能改变 DOM 顺序或工具语义。

## 无障碍

- 每个快捷项必须是原生 `button`，带 `aria-label` 和 `title`。
- 浮层提供 `aria-expanded`；Escape 收起，Tab 只在展开项内循环或按顺序离开浮层。
- 禁用项使用 `disabled`/`aria-disabled` 并说明原因，不能只降低透明度。

## 销毁

`dispose` 清除全局/容器监听、pointer capture、待执行动画帧和本地状态；不得遗留浮层节点或订阅。
