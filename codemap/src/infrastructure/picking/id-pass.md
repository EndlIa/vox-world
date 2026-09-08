# id-pass.ts

**职责**：将体素、选择和遮罩 id 编码进颜色通道。
**接口**：render、encodeId、decodeId、setLayer。
**内部**：处理 RGB24 或更高位编码、边缘留白、透明和深度策略。
**依赖**：three、shader material。
