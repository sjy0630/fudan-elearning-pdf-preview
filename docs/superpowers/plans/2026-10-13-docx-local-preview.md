# DOCX 本地预览实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 交付批准规格中的 DOCX 本地内容预览，先油猴、再扩展，保留 PDF/图片/文本及原字节下载。

**Architecture:** 独立的边界策略、ZIP 目录检查、受限流式解压、OOXML 预检与转换模块组成后台核心。输出经专用清理器进入无脚本、无同源权限的隔离预览；控制器独立保留原字节并管理取消、超时与过期结果。只有预览适配器验收后才注册 DOCX 到现有格式入口。

**Tech Stack:** Node.js 原生测试、现有 fflate/esbuild/Playwright，候选 Mammoth 1.13.0、DOMPurify 3.4.17；固定依赖在转换阶段核对发行内容后安装。

---

## 📋 顺序与交付门槛

本计划先详细执行可独立验证的安全边界模块。其后每个安全核心、转换、界面阶段在修改前展开为独立的完整测试优先任务；下表保留完整目标，不把完成边界模块当作 DOCX 交付完成。用户已要求进入实施，使用当前功能分支连续执行，不在任务之间重复询问是否继续。

| 阶段 | 负责文件 | 完成证据 |
| --- | --- | --- |
| 共享边界 | `shared/docx-policy.mjs` | 精确限额、输入类型、MIME/签名与只读策略测试 |
| ZIP 目录与解压 | `shared/docx-zip.mjs` | STORE/DEFLATE/描述符、CRC、实际解压量、冲突及结构攻击测试 |
| OOXML 预检 | `shared/docx-package.mjs` | 非宏正文、关系、实体、安全路径、复杂特性提示测试 |
| 后台转换 | `shared/docx-convert.mjs`、`shared/docx-worker.mjs` | 真实 DOCX 内容、图片、脚注与内嵌样式禁用验证 |
| 输出及生命周期 | `shared/docx-sanitize.mjs`、`shared/docx-runtime.mjs` | 恶意 HTML、图片验证、隔离、取消、超时、原字节不变 |
| 油猴接入 | `userscript/preview.template.js`、`scripts/build-userscript.mjs` | 真实阅读、关闭/重开、无外网、原始下载与旧格式回归 |
| 扩展接入 | `extension/catalog.js`、独立 DOCX 页面与构建器 | Chromium/Edge/Firefox 安装包验收，不扩大权限 |
| 交付复核 | 测试、说明、许可证及版本记录 | 可复现源码/安装包、准确大小/哈希和完整规格复核 |

在 ZIP/OOXML 完整通过前，传输签名检查不是“已验证 DOCX”；不能据此开放下载或把任意 ZIP 当成文档。

## 🔧 Task 1：不可变边界策略与传输入口

**Files:** Create `shared/docx-policy.mjs`; create `tests/docx-policy.test.cjs`。不改现有格式注册表、路由、生成文件或产品版本。

- [ ] Step 1：写最小失败测试并确认缺少导出，而非测试语法错误。

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const file = path.join(__dirname, '../shared/docx-policy.mjs');
const api = async () => fs.existsSync(file) ? import(pathToFileURL(file).href) : {};
test('DOCX policy is exported, immutable and matches approved byte budgets', async () => {
  const m = await api();
  assert.ok(m.DOCX_LIMITS, 'DOCX_LIMITS export must exist');
  assert.ok(Object.isFrozen(m.DOCX_LIMITS));
  assert.equal(m.DOCX_LIMITS.fileBytes, 20 * 1024 * 1024);
  assert.equal(m.DOCX_LIMITS.expandedBytes, 60 * 1024 * 1024);
  assert.equal(m.DOCX_LIMITS.timeoutMs, 20000);
});
```

Run `node --test tests/docx-policy.test.cjs`。Expected：FAIL `DOCX_LIMITS export must exist`。记录该失败后才创建产品模块。

- [ ] Step 2：实现纯数据策略；为其余常量逐项添加先失败的断言再补值。

```javascript
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOCX_LIMITS = Object.freeze({
  fileBytes: 20 * 1024 * 1024,
  entries: 1000,
  entryBytes: 20 * 1024 * 1024,
  expandedBytes: 60 * 1024 * 1024,
  xmlBytes: 4 * 1024 * 1024,
  htmlBytes: 4 * 1024 * 1024,
  nodes: 50000,
  images: 200,
  imagePixels: 40000000,
  timeoutMs: 20000,
});
```

- [ ] Step 3：先为 `checkDocxTransfer(input, mime)` 写失败测试。覆盖 Uint8Array、ArrayBuffer、带偏移的 DataView；不复制、不修改、不转移输入；空值/正式 MIME/通用二进制可进入后续验证。错 MIME、HTML、超限、截断、错误签名和 OLE 旧格式/加密容器明确拒绝。普通 ZIP 的传输头只能进入进一步校验，不能证明真实 DOCX。

```javascript
test('transfer check preserves view boundaries and original bytes', async () => {
  const m = await api();
  assert.equal(typeof m.checkDocxTransfer, 'function');
  const buffer = Uint8Array.from([0, 0x50, 0x4b, 3, 4, 0]).buffer;
  const result = m.checkDocxTransfer(new DataView(buffer, 1, 4), 'application/octet-stream');
  assert.equal(result.byteLength, 4);
  assert.equal(result.byteOffset, 1);
  assert.equal(result.buffer, buffer);
  assert.deepEqual([...result], [0x50, 0x4b, 3, 4]);
  assert.equal(buffer.byteLength, 6);
});
```

实现参考（可优化类型判断，但不得减少边界或增加网络副作用）：

```javascript
export function checkDocxTransfer(input, mime = '') {
  let bytes;
  if (input instanceof Uint8Array) bytes = input;
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else throw new Error('DOCX 文件数据无效。');
  if (bytes.byteLength > DOCX_LIMITS.fileBytes) throw new Error('DOCX 文件大小超过预览限制（20 MiB）。');
  const type = String(mime).split(';')[0].trim().toLowerCase();
  if (type === 'text/html' || type === 'application/xhtml+xml') throw new Error('服务器返回了网页，可能需要重新登录。');
  if (type && type !== DOCX_MIME && type !== 'application/octet-stream') throw new Error('文件类型与 DOCX 预览不符。');
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (ole.every((value, i) => bytes[i] === value)) throw new Error('加密 Office 或旧版 Word 文件暂不支持预览。');
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw new Error('不是支持的 DOCX 容器，或文件已损坏。');
  return bytes;
}
```

- [ ] Step 4：补明确的正向和反向测试，必须覆盖精确 20 MiB 与超一字节、大小写 MIME/charset、非字节输入、偏移视图、输入保留和无 DOM/网络副作用。`node --test tests/docx-policy.test.cjs` 与 `node --check shared/docx-policy.mjs` 均应通过。
- [ ] Step 5：先进行独立规格审查，通过后进行代码质量审查；修复并重审所有重要问题。
- [ ] Step 6：仅提交模块与对应测试：`git add shared/docx-policy.mjs tests/docx-policy.test.cjs && git commit -m "feat: add bounded DOCX transfer policy"`。更新任务勾选和实测记录，不把本阶段称为可用 DOCX 阅读器。

## ✅ 全程不变量

- [ ] 所有模块遵循批准规格的实际资源限额；不使用声明大小替代实际解压统计。
- [ ] 不只提取文字作为成功交付；正文、表格、图片与脚注必须真实显示。
- [ ] 默认无文档外部请求、无脚本、无页面同源权限；失败不修改 CSP。
- [ ] 原始字节独立保留；下载条件区分传输、包验证和转换状态。
- [ ] 两版接入均验收后才称本轮完整；没有商店提交或自动发布行为。
