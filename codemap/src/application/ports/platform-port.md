# platform-port.ts

**职责**：应用层对宿主文件与剪贴板能力的抽象。
**接口**：openFile、saveFile、readClipboard、writeClipboard。
**内部**：只描述宿主能力，不暴露浏览器或 Electron 类型，也不提供 isBrowser/isElectron 判断。
**依赖**：application types。
