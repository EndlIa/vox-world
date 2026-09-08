# palette-panel.ts

**职责**：渲染颜色调色板，处理颜色选择、隐藏颜色切换、网格布局和键盘导航。
**接口**：mount(host, viewModel, actions)；update(snapshot)；resize()；dispose()。
**内部**：只把 view model 中的颜色集合绘制到 canvas；选择/隐藏通过 actions 发出，不直接修改体素、可见性或渲染对象。
**依赖**：ui/editor-view-model、ui/actions、ui/dom-contract、DOM Canvas、ResizeObserver。

## DOM 与绘制

- 使用 `#palette` 容器和 `#canvas_palette` canvas；canvas 由本模块独占。
- 根据 `devicePixelRatio` 设置 backing store 尺寸，CSS 尺寸保持逻辑像素，避免模糊和命中坐标漂移。
- 网格单元默认宽 39、高 25、间距 2；列数来自偏好，限制为 1–20。
- 面板宽度为 `8 + (39 + 2) * columns`，不得依赖固定 `32000px` 高度来容纳所有颜色。
- `ResizeObserver` 只触发一次 `requestAnimationFrame` 重绘；同一帧多次 resize 合并。
- 重绘输入为不可变快照：唯一颜色、隐藏颜色集合、当前颜色、列数。
- 隐藏颜色必须使用轮廓/图案等非颜色单独可辨的视觉标记，不能只靠色差。
- 当前颜色必须使用焦点框或描边标记，并保持可访问名称。

## 指针行为

- `pointerdown` 只处理主按钮/触摸接触；命中颜色后发送 `palette.selectColor(hex)`。
- `contextmenu` 阻止浏览器菜单并发送 `palette.toggleVisibility(hex)`；双击提供同一语义的桌面替代。
- 命中空白区域不改变选择；坐标通过 canvas 的逻辑坐标计算，不能直接使用未缩放 `offsetX/offsetY`。
- 当 XFORM 会话处于活动状态时，右键/双击隐藏颜色的操作必须忽略，避免与变换流程冲突。
- pointerdown 后如使用 capture，必须处理 `pointercancel`、`lostpointercapture` 和 `dispose` 释放。
- 触摸点击必须阻止页面滚动/缩放，但只在 canvas 范围内调用 `preventDefault`。

## 键盘与无障碍

- canvas 可聚焦，提供 `role="grid"`、`aria-label` 和当前行列的 `aria-activedescendant` 等价描述。
- 方向键在颜色网格内移动焦点；Home/End 移到行首/行尾；PageUp/PageDown 跨行移动。
- Enter/Space 选择当前颜色；Shift+Space 或 context-menu 键切换隐藏状态。
- 焦点移动时显示可见 focus ring，并通过 `aria-live` 播报颜色 hex 与隐藏状态。
- 键盘操作不得冒泡到全局工具快捷键。

## 更新与销毁

- `update` 只比较颜色集合、隐藏集合、当前颜色和列数；无变化时不重绘。
- 颜色列表增删使用稳定 hex 顺序，保留焦点到同一颜色；被删除时移动到相邻项。
- `dispose` 断开 ResizeObserver、取消待执行的动画帧、释放 capture 并清空 canvas 监听。
