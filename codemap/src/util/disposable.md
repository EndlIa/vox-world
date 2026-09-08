# disposable.ts

**职责**：统一资源释放协议。
**接口**：dispose()、disposed 状态。
**内部**：按逆序释放事件、GPU 资源、Worker 和 DOM 引用；保证幂等。
**依赖**：none。
