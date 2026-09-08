# worker-protocol.ts

**职责**：Worker 请求、响应和进度消息协议。
**接口**：WorkerRequest、WorkerResponse、ProgressEvent、错误类型。
**内部**：使用可辨识联合和结构化克隆安全的数据；禁止传递类实例。
**依赖**：none。
