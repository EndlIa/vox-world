# packed-int.ts

**职责**：打包体素坐标和稳定 id。
**接口**：pack、unpack、compare、neighbor、boundsCheck。
**内部**：为稀疏 Map 提供无字符串分配的键；定义明确坐标范围和溢出检查。
**依赖**：none。
