# worker-port.ts

**职责**：后台任务端口。
**接口**：run、cancel、subscribeProgress、dispose。
**内部**：统一请求 id、transferable、错误和进度语义。
**依赖**：worker-protocol。
