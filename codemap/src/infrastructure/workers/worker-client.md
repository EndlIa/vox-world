# worker-client.ts

**职责**：主线程 Worker 客户端。
**接口**：run、cancel、subscribeProgress、dispose。
**内部**：管理 worker 池、请求 id、超时、transferable 和错误重试。
**依赖**：worker-protocol。
