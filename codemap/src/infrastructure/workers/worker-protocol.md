# worker-protocol.ts

**职责**：Worker 请求、响应和进度消息协议。
**接口**：WorkerRequest、WorkerResponse、ProgressEvent、错误类型。
**内部**：使用可辨识联合和结构化克隆安全的数据；禁止传递类实例。体素算法请求只携带目标 `VoxObjectId` 的局部快照和局部参数，场景结构/节点变换不进入算法 Worker。
**依赖**：scene-types。
