# controls.ts

**职责**：提供颜色选择器、数值/文本/选择/复选/滑杆控件、滑动确认框、通知和其他通用 DOM 控件。
**接口**：register(control)；setValue(key, value)；openColorPicker(target)；confirm(options): Promise<boolean>；notify(event)；dispose()。
**内部**：控件只处理值、校验、键盘/焦点、显示状态和 DOM 生命周期；业务变化通过 actions 发出，不直接修改领域状态。
**依赖**：DOM、ui/actions、ui/editor-view-model、ui/dom-contract。

## 通用控件契约

每个控件至少实现：

```ts
interface UiControl<T> {
  mount(host: HTMLElement): void;
  setValue(value: T): void;
  getValue(): T;
  setDisabled(disabled: boolean, reason?: string): void;
  focus(): void;
  dispose(): void;
}
```

- 控件必须显式声明 `input`、`change`、`blur` 或 `keydown` 的提交语义，不能同时向业务发送重复值。
- `setValue` 只更新 DOM，不反向触发业务事件；用户交互才发出 action。
- 数值控件校验有限值、min/max/step 和空值；非法值显示可访问错误信息并保留原值。
- 文本控件 trim 后提交；空值是否允许由控件参数决定。
- range 可在拖动中发 `preview`，在 `change` 时提交最终值。
- 复选框和选择框提交布尔值/枚举值，不使用字符串隐式转换。
- 禁用控件必须设置原生 `disabled` 或 `aria-disabled`，并说明禁用原因。

## 颜色选择器

颜色选择器覆盖 `#color-picker`、`#color-picker-wheel`、`#color-picker-selected`、`#color-picker-hex` 和 `#color-picker-rgb-{r,g,b}`。

### 打开与关闭

- `openColorPicker(target)` 记录触发 input、原值、原焦点和当前 `previous` 颜色。
- 面板使用 fixed 定位，按当前指针或触发元素定位，并在四边留至少 10px 内边距；越界时平移而非扩大视口。
- 打开后显示 blocker，阻止画布和其他 UI 接收指针；全局编辑快捷键暂停。
- 点击 blocker 提交当前颜色并关闭；Escape 取消并恢复原值；关闭后焦点回到触发控件。
- 关闭必须释放 blocker、键盘监听和临时 preview 状态；重复关闭幂等。

### 色轮与输入

- 色轮是 live preview 来源：拖动时更新 `current`、HEX、RGB 和触发 input 的 `input` 事件。
- HEX 只接受 `#RRGGBB`（大小写均可），保存统一大写；非法值显示 `invalid hex color [#RRGGBB]`，不改变当前颜色。
- RGB 三个输入分别接受 0–255 整数；非法值显示 `invalid color (0-255)`，不改变当前颜色。
- 任一合法输入更新其他表示和色轮；避免循环触发。
- `Previous` 色块显示打开前的颜色，点击后把色轮切回 previous；`Current` 色块实时显示当前颜色。
- 提交时更新 target 的 value，并按控件语义发送一次 `change`（必要时再发送 `input`）；取消时不得留下 preview。

### 无障碍

- 打开颜色选择器时把焦点移入色轮或 HEX 输入，设置 `role="dialog"`、`aria-modal="true"` 和可访问名称；Tab 在色轮、HEX、RGB、Previous、Current 之间循环，关闭后恢复到原触发控件。
- 色轮提供键盘替代：方向键调整 hue/saturation，Shift+方向键细调，Enter 提交，Escape 取消。
- HEX/RGB 输入有关联 label、`aria-invalid` 和错误描述。
- Previous/Current 是带可访问名称的按钮，不只依赖颜色视觉。

## 滑动确认框

确认框覆盖 `#confirm` 和 `#confirmblocker`，返回 `Promise<boolean>`。

- `confirm({ target, message?, threshold? })` 以目标元素矩形为锚点，并设置 blocker；目标消失或不在视口时取消。
- 默认完成阈值 `0.65`，可配置但必须限制在 `(0, 1]`。
- pointerdown 记录起始 X、最大可滑动距离和当前左偏移；pointermove 将偏移 clamp 到 `[0, maxSwipe]`；pointerup 达到阈值才接受。
- 未达到阈值时回弹到 0；pointercancel、lostpointercapture、窗口失焦时立即复位并返回取消。
- blocker 点击返回 `false`；用户偏好 `ignore-confirms` 为真时立即返回 `true` 并隐藏 UI，不等待滑动。
- 确认框打开时只允许该流程接收键盘/指针；Enter 接受、Escape 取消；关闭后恢复原焦点。
- 确认框使用 `role="alertdialog"`、`aria-modal="true"` 和可访问名称；打开后焦点进入滑动柄，Tab 不得落到 blocker 后面的画布或面板。
- 确认流程必须避免重复 resolve，并在每次关闭后清理 pointer capture、document 监听和 blocker。

## 通知

- 通知只有一个可见槽位；新通知替换旧通知，并取消旧计时器。
- 等级为 `info`、`warning`、`error`，分别使用默认、warning、error 的 CSS token/样式；文本统一大写，warning/error 加前缀。
- 默认超时 3000ms；调用方可传入有限正数；超时为 0 表示必须显式关闭。
- 替换时更新文本、等级和计时器，不创建无限累积的 DOM 节点。
- 通知使用 `aria-live="polite"`，错误使用 `role="alert"`；关闭后从无障碍树移除。
- `dispose` 清除计时器和监听器，移除通知节点。

## 其他控件与销毁

- 所有控件由 `Bindings` 统一批量刷新；控件本身不直接订阅全局应用状态。
- 内联重命名输入按 `bindings.ts` 的事件传播和唯一名称规则实现，不在控件内直接改领域模型。
- `dispose` 必须移除事件监听、observer、计时器、blocker、生成的节点和 pointer capture。
