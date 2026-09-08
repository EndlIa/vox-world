# png-sequence-writer.ts

**职责**：把离线动画帧作为 PNG 文件直接写入调用方提供的目录句柄，并管理单文件 writable 的生命周期；不负责目录选择、文件名编号或相机求值。

**接口**：
- `createPngSequenceWriter({ directory, filePrefix, frameEnd }): AnimationOutputWriter`。
- 实现 `AnimationOutputWriter`：`addFrame(blob, { frame, totalFrames, filename })`、`finalize({ cancelled }): Promise<AnimationOutputResult>`、`abort(reason?): Promise<void>`。
- `dispose()` 只释放 writer 自身状态，不删除已写入文件；`abort` 与 `finalize` 必须幂等。

**内部**：
- 目录句柄由 `animation-render-service` 通过平台端口一次性取得；本模块不得直接调用 `showDirectoryPicker()`，也不得弹出文件选择器。
- `addFrame` 以 `directory.getFileHandle(filename, { create: true })` 获取目标，再 `createWritable()`、`write(blob)`、`close()`。每次写入都使用 renderer 生成的零填充文件名，禁止覆盖临时随机名或打包 ZIP。
- 只接受 `image/png` Blob；空 Blob、文件名含路径分隔符或非法字符时拒绝。目录中同名文件按用户选择覆盖，行为必须由服务层在开始前说明。
- 取消时停止继续写入，但已经完整写入的 PNG 保留；不尝试回滚目录内容。`finalize` 必须幂等，不重复关闭同一 writable。
- 写入失败、权限撤销或磁盘错误必须保留原始错误并让 renderer 的 `finally` 执行编辑器状态恢复；不得吞掉错误或把部分成功报告为成功。

**依赖**：platform-port 的目录句柄类型、animation-renderer 的 writer 契约。
