# result.ts

**职责**：显式成功或失败结果。
**接口**：ok(value)、err(error)、map、unwrapOr。
**内部**：用于可预期失败，避免用异常表达普通业务分支。
**依赖**：none。
