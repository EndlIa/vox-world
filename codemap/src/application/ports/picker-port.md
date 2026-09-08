# picker-port.ts

**职责**：应用层对拾取实现的抽象。
**接口**：pick、pickMany、setLayer、invalidate、dispose。
**内部**：返回稳定 PickResult，不泄漏 render target 或实例实现细节。
**依赖**：pick-result。
