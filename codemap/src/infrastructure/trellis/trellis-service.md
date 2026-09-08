# trellis-service.ts

**职责**：Trellis 外部生成能力的独立集成。
**接口**：generate、cancel、status、importResult。
**内部**：与核心编辑流程通过命令和端口通信；网络或任务失败不影响编辑器状态。
**依赖**：platform-port、worker-port。
