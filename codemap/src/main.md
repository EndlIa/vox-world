# main.ts

**职责**：浏览器或 Electron 的入口。
**接口**：start(rootElement)：挂载应用并返回可释放句柄。
**内部**：定位根节点、建立错误边界、调用 bootstrap、页面卸载时释放。
**依赖**：app/bootstrap、app/lifecycle。
