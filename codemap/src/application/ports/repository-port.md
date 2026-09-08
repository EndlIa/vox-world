# repository-port.ts

**职责**：项目持久化端口。
**接口**：load、save、list、remove、supports。
**内部**：以字节或版本化文档为边界；隐藏 IndexedDB、文件系统和 Electron 差异。
**依赖**：project document。
