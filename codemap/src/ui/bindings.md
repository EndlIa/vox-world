# bindings.ts

**职责**：集中注册 DOM 事件、view model 订阅和批量 DOM 更新。
**接口**：bind(root, viewModel, actions, controllers): BindingsHandle；unbind()；sync(snapshot)；flush()。
**内部**：使用事件委托、稳定选择器和可取消监听；所有更新按帧合并，组件销毁时释放全部监听、observer、计时器和 pointer capture。
**依赖**：DOM、ui/editor-view-model、ui/actions、ui/controls、ui/panels、ui/dom-contract。

## 事件绑定契约

- 结构性 UI 只绑定一次；禁止每次 `sync` 重新 `addEventListener`。
- 优先在 `#menus`、`#toolbar`、面板容器上做事件委托，以 `data-action`、`data-tool-id`、`data-panel-key` 或稳定 ID 分发。
- 每个监听器由同一个 `AbortController` 或 `Disposable` 管理；`unbind` 后不得再触发 action。
- 对 `click`、`pointerdown`、`pointermove`、`pointerup`、`pointercancel`、`lostpointercapture` 的注册必须与控制器所有权一致，禁止多个模块绑定同一全局事件。
- 画布编辑/导航的全局 pointer、keyboard、gesture 监听只由 app 装配的 input routers 拥有；`bindings.ts` 不得复制一套全局快捷键或 canvas capture。UI 控件只拥有自身局部拖拽 capture。
- 文件输入统一遵循：触发按钮 `click()` -> `change` -> 只读取一次 `files` -> 发送 `file.selected` -> 无论成功失败都清空 `input.value`，允许再次选择同一文件。

## 批量 DOM 更新

- `sync` 只记录最新快照并调度一次 `requestAnimationFrame`；同一帧内多次更新合并为一次 `flush`。
- `flush` 先计算字段级差异，再更新文本、属性、类名、禁用状态和可见性；不重建未变化的 DOM 子树。
- 列表更新使用稳定 key（如颜色 hex、keyframe id、snapshot id）做增删改，避免整表 `innerHTML = ''`。
- 连续输入（range、颜色预览、动画时间）允许使用最新值覆盖旧值，但不得每像素触发布局读取。
- 读取 `getBoundingClientRect` 和写入样式不得在同一循环中交错；需要时先批量读取，再批量写入。
- `flush` 必须幂等，且在卸载/窗口不可见时可以安全取消。

## 焦点与快捷键过滤

- 全局快捷键只在焦点不位于 `input`、`textarea`、`select`、`[contenteditable="true"]`、`[role="textbox"]` 或带 `.ignorekeys` 的控件时生效。
- 颜色选择器、确认框和其他模态层打开时，全局编辑快捷键暂停。
- 内联重命名输入必须对 `click`、`dblclick`、`keydown`、`keyup` 调用 `stopPropagation`，防止选中对象或触发全局快捷键。
- Enter 提交、Escape 取消、blur 提交；提交前 trim，空名称或无效名称给出通知并保持编辑状态。

## 内联重命名契约

- 同一列表同一时间只能有一个编辑器；创建新编辑器前提交或取消旧编辑器。
- 初次进入时 `focus()` 并 `select()` 全部文本。
- 提交必须通过动作层执行唯一化：名称 trim 后不得为空；冲突时由领域/应用返回唯一名称或 `_2`、`_3` 后缀。
- Enter、Escape、blur 只能完成一次；用 `isFinished` 等幂等守卫避免 blur 重复提交。
- Escape 恢复原名；提交成功后使用 view model 的新名称重绘；失败时恢复焦点和原名称。
- 事件传播规则必须覆盖鼠标和触摸路径，避免文本编辑同时触发列表选择或画布手势。

## 无障碍与销毁

- 动态状态使用 `aria-pressed`、`aria-expanded`、`aria-disabled`、`aria-valuenow` 等属性表达，不只依赖颜色。
- 切换可见性后把焦点保留在触发控件；关闭模态层后恢复到打开它的元素。
- `unbind` 清理事件委托、view model 订阅、requestAnimationFrame、ResizeObserver 和控件实例。
- 所有清理必须幂等，异常清理路径不得影响其他绑定。
