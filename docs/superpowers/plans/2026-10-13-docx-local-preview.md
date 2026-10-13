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

- [x] Step 1：写最小失败测试并确认缺少导出，而非测试语法错误。

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

- [x] Step 2：实现纯数据策略；为其余常量逐项添加先失败的断言再补值。

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

- [x] Step 3：先为 `checkDocxTransfer(input, mime)` 写失败测试。覆盖 Uint8Array、ArrayBuffer、带偏移的 DataView；不复制、不修改、不转移输入；空值/正式 MIME/通用二进制可进入后续验证。错 MIME、HTML、超限、截断、错误签名和 OLE 旧格式/加密容器明确拒绝。普通 ZIP 的传输头只能进入进一步校验，不能证明真实 DOCX。

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

- [x] Step 4：补明确的正向和反向测试，必须覆盖精确 20 MiB 与超一字节、大小写 MIME/charset、非字节输入、偏移视图、输入保留和无 DOM/网络副作用。`node --test tests/docx-policy.test.cjs` 与 `node --check shared/docx-policy.mjs` 均应通过。
- [x] Step 5：先进行独立规格审查，通过后进行代码质量审查；修复并重审所有重要问题。
- [x] Step 6：仅提交模块与对应测试：`git add shared/docx-policy.mjs tests/docx-policy.test.cjs && git commit -m "feat: add bounded DOCX transfer policy"`。更新任务勾选和实测记录，不把本阶段称为可用 DOCX 阅读器。

Task 1 证据：提交 `41d847bb0d38a6a9eac2860cd1895904f922d268`；首次测试缺少 `DOCX_LIMITS`，后续传输测试缺少 `checkDocxTransfer`；实施者、主代理与独立审查各自运行专用测试，15/15 通过，模块/测试语法通过。规格、质量审查无未解决问题。此模块只做传输入口初筛。

## 🔧 Task 2：ZIP 结构与受限实际解压

**Files:** Create `shared/docx-zip.mjs`, `tests/docx-zip.test.cjs`。使用现有固定 fflate；不修改格式入口。API 为 `scanDocxZip(input)`（返回有界目录条目）与 `expandDocxZip(input)`（返回 `Map<string, Uint8Array>`）。输入先调用 Task 1 的传输检查。

- [ ] Step 1：先写测试并运行 `node --test tests/docx-zip.test.cjs`，确认缺少函数导致断言失败，再创建模块。

```javascript
test('ZIP scanner and bounded expander exist', async () => {
  const m = fs.existsSync(file) ? await import(pathToFileURL(file).href) : {};
  assert.equal(typeof m.scanDocxZip, 'function');
  assert.equal(typeof m.expandDocxZip, 'function');
});
```

- [ ] Step 2：用 fflate `zipSync` 构造 STORE、DEFLATE、带目录和 UTF-8 名称的普通测试包；用 fflate `Zip`/`ZipPassThrough`/`ZipDeflate` 构造合法 signed descriptor 包，另构造 unsigned descriptor。先添加失败的行为测试，再逐项实现结构校验。EOCD 在尾部有界扫描，支持合法注释；核对磁盘、计数、中央目录大小/偏移、每条中央头与本地头、名称/标记/方法、数据范围、描述符 CRC 与大小。拒绝截断、ZIP64 extra/sentinel、多卷、加密及非 STORE/DEFLATE、重复名称、文件与目录冲突、重叠区与目录碰撞。

```javascript
const bytes = zipSync({'word/document.xml': strToU8('<document/>')}, {level: 6});
assert.equal(new TextDecoder().decode(expandDocxZip(bytes).get('word/document.xml')), '<document/>');
```

- [ ] Step 3：名字禁止空段、绝对路径、反斜线、控制符、驱动器/URI/编码后逃逸及 `.`/`..`；允许普通相对层级及目录尾斜线。名字用严格 UTF-8 解码，普通 DOCX 的 ASCII 路径不受影响。额外字段长度有界，ZIP64 拒绝。
- [ ] Step 4：流式 `Inflate` 每次最多输入 256 字节，回调立即累计实际输出、CRC 和 XML/单项/全包预算；超限当场停止，不先全量 unzip。STORE 同样按实际字节与 CRC 验证。最终校对实际输出与声明大小，保留原输入不变。断言 1,000 项、20 MiB 单项、60 MiB 总量、4 MiB XML 边界；篡改声明大小的高压缩率炸弹必须在实际输出时拒绝。
- [ ] Step 5：`node --test tests/docx-policy.test.cjs tests/docx-zip.test.cjs` 与语法检查通过；独立规格审查后代码质量审查，修复并重审；只提交该模块与测试。

## 🔧 Task 3：受限 OOXML 包验证

**Files:** Create `shared/docx-package.mjs`, `tests/docx-package.test.cjs`；依赖阶段允许修改 `package.json`/lock。固定安装 `@xmldom/xmldom@0.9.12`（MIT），供纯 Worker 兼容 XML 解析。API `verifyDocxPackage(input)` 返回 `{parts, documentPath, warnings}`，只有该函数成功才允许原字节下载。`parts` 是 Task 2 返回的有界 Map。

- [ ] Step 1：先写缺失导出测试，确认失败。用 fflate 构造真正的最小 OOXML 结构进行单元测试：`[Content_Types].xml`、`_rels/.rels`、`word/document.xml`。正文根必须是 WordprocessingML `document` 且有 `body`；标准 transitional 命名空间用于初版转换。

```javascript
assert.equal(typeof api.verifyDocxPackage, 'function');
const result = api.verifyDocxPackage(minimalWordZip);
assert.equal(result.documentPath, 'word/document.xml');
assert.ok(result.parts.has('word/document.xml'));
```

- [ ] Step 2：`expandDocxZip` 后对所有 XML/关系部件执行严格有界 XML 解析；UTF-8/UTF-16 BOM 合法，声明编码与实际匹配，拒绝 DTD/ENTITY、解析警告/错误、未知实体、错误命名空间、重复属性与过度节点/嵌套。用迭代遍历统计节点，不因递归溢出漏检。固定单 XML 4 MiB，并累计合理文档节点预算。
- [ ] Step 3：检查内容类型的 Default/Override 重复及每个包部件类型；根关系唯一非外部 `officeDocument` 指向存在的非宏 Word 主文档，其 ContentType 精确为 `application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml`。拒绝宏/模板/其他 Office 主文档、vba 部件与宏关系；支持常规正文相对位置，转换阶段不得假定正文总是默认位置。
- [ ] Step 4：每个 `.rels` 按对应源部件目录解析内部 Target，支持合法 `../` 但归一化后仍须留在包内；禁止绝对/协议/驱动器/反斜线、编码逃逸、查询或非法片段，不请求任何外部 Target。内部指向必须存在；ID 唯一、关系根/属性合法。外部超链接保留警告，外部图片/对象给出缺失说明。不把外部目标视为本地文件。
- [ ] Step 5：对公式、SmartArt/图表、修订、嵌入对象、altChunk、页眉页脚/浮动布局及不支持图片部件生成去重的中文内容局限提示。安全可见内容进入后续转换，不静默宣称完整。
- [ ] Step 6：测试普通包、非默认正文位置、列表/脚注关系；错误类型/宏伪装、DTD/实体、畸形 XML、重复 IDs/types、内部逃逸/失踪目标、外部关系无读取、特性警告、输入不变；专用测试及旧测试通过，规格与质量审查后提交。

## 🔧 Task 4：固定依赖、真实样例与 Worker 转换

**Files:** Create `shared/docx-convert.mjs`, `shared/docx-worker.mjs`, `scripts/docx-fixtures.mjs`, `tests/docx-convert.test.cjs`, `tests/fixtures/docx/*`；修改依赖及 lock。固定 Mammoth 1.13.0、DOMPurify 3.4.17，样例生成使用 docx 9.10.0 开发依赖，记录完整许可与发行完整性。API `convertDocx(input, {idPrefix})` 异步返回 `{html, images, warnings}`。`images` 为 `{id,mime,bytes}` 数组，HTML 仅用 `docx-image-N` 标记，无真实资源 URL。

- [ ] Step 1：写缺失导出 RED，安装核对候选包。阅读发行 README/Security/License；Mammoth 仅使用固定本地 browser 入口，Worker 打包不得残留 Node 文件系统、HTTP、CDN 或动态远程执行。
- [ ] Step 2：依 DOCX 生成技能，用 docx-js 创建原创中文样例：标题、中文段落、粗斜体/上下标、嵌套编号、合并表格、脚注/尾注及 PNG/JPEG 至少两类图片。独立验证 OOXML 可打开，固定生成脚本、样例文件和许可；不是用 mock HTML 作为最终证据。

```javascript
const result = await convertDocx(new Uint8Array(await readFile(fixture)), {idPrefix:'test-docx-'});
assert.match(result.html, /中文正文/);
assert.match(result.html, /<table>/);
assert.equal(result.images.length, 2);
```

- [ ] Step 3：转换先完成包验证。Mammoth 配置 `includeEmbeddedStyleMap:false`, `externalFileAccess:false`, 每次命名空间 `idPrefix`；只收集内嵌图片，不读取外部目标。图片返回独立字节与内部标记，限制数量、字节、HTML UTF-8 大小；警告去重/有界。禁用嵌入样式映射以避免文档改变固定标签结构。
- [ ] Step 4：Worker 的消息协议为 `{id,bytes,mime}`；完成包验证先发 `{id,type:'verified'}`，再发 `{id,type:'result',...result}`；失败发 `{id,type:'error',message}`。入口不提供 URL、文件系统或网络权限。转换被杀死不影响原字节；纯模块可在 Node 单测，浏览器 Worker 真实运行留到集成验收。
- [ ] Step 5：真实内容、脚注、表格跨度、PNG/JPEG、图片标记与输入保留测试；恶意链接/embedded-style-map、错误包、外部图片、不支持复杂内容警告测试；固定构建检查与两阶段审查后提交。

## 🔧 Task 5：输出清理、图片验证及任务生命周期

**Files:** Create `shared/docx-sanitize.mjs`, `shared/docx-runtime.mjs`, `tests/docx-runtime.test.cjs`, `tests/docx-sanitize.test.cjs`；必要浏览器验证脚本在后续任务共享。不得修改现有入口。共享格式头解析沿用 `CanvasFileFormats.validate`，纯测试可加载当前注册表。

- [ ] Step 1：缺失函数 RED。`runDocxTask(bytes,mime,{signal,makeWorker,onVerified})` 返回转换结果 Promise；`makeWorker()` 返回 `{worker,dispose}`，用户脚本工厂撤销本地 Blob URL，扩展工厂使用包内 Worker URL。原字节只读保留，发送 `bytes.slice()` 的独立副本并 transfer 副本；固定 20 秒截止时间。

```javascript
const original = new Uint8Array([0x50,0x4b,3,4]);
const promise = runDocxTask(original,'',{signal,makeWorker,onVerified});
assert.deepEqual([...original],[0x50,0x4b,3,4]);
```

- [ ] Step 2：只接受当前 ID；`verified` 只能出现一次，`result` 必须在 verified 之后且 HTML/图片/警告结构和大小有界。成功、error、messageerror、构造/CSP 失败、超时、abort 都移除 handler/timer/listener，terminate 并 dispose；旧结果不能恢复 promise 或触发 verified。真实 DOMException AbortError 表示取消，不显示为解码失败。取消若在开始前发生，不创建 Worker。
- [ ] Step 3：`sanitizeDocxOutput(window,result,{signal,formats})` 异步返回 `{srcdoc,warnings}`；DOMPurify 每次独立实例，固定标签只保留 p/h1-h6/em/strong/u/s/sub/sup/br/hr/ol/ul/li/table/thead/tbody/tfoot/tr/td/th/img/a及必要脚注结构。清除 untrusted `src/href/srcset/style/events/forms/script/svg/math/object/iframe/meta/base`。只捕获格式为 `docx-image-N` 的图片标记后恢复验证图片，不允许任何原始 URL。
- [ ] Step 4：在解码前核对图片签名/MIME、每图字节/维度、数量、总头部像素 <=4,000万；原生 Image 实际解码再次核对维度（容许 EXIF 交换），累计实际像素。逐图 URL 必须 finally 撤销；信号与有界超时可中止解码；不支持图片使用占位及明确提示。data URL 仅项目从验证后的 PNG/JPEG/WebP 字节生成。
- [ ] Step 5：节点 <=50,000，内容 HTML <=4MiB；ID 改为内部命名空间，不继承名称；colspan/rowspan 只受限正整数。第一版移除所有 href（含片段），保留脚注编号/内容并提示不提供跳转，避免 srcdoc 学校基址请求。外部网址仅可读文字。固定 srcdoc 包装含 CSP `default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`、UTF-8 与项目静态 CSS；内容没有活动样式或链接。
- [ ] Step 6：Node 生命周期测试覆盖超时/取消/旧消息/异常/资源清理/原字节不变，真实 Chromium/Firefox 页面验证 sanitizer 恶意内容/URL/DOM污染/总像素/解码失败/最终 CSP。最终两版 iframe 必须另设 `sandbox=""`，不授予任何 token。两阶段审查后提交。

## 🔧 Task 6：先接入油猴单文件安装包

**Files:** Modify `userscript/preview.template.js`, `scripts/build-userscript.mjs`, `shared/formats.js` 与现有相关测试；create `scripts/bundle-docx.mjs`, `tests/docx-bundle.test.cjs`, `scripts/smoke-docx.mjs`。运行时依赖全部本地固定打包；许可内嵌。生成文件通过 generator 更新，不手工编辑。

- [ ] Step 1：缺失 DOCX API/打包标记 RED。`bundleDocx()` 用 esbuild 生成本地 browser IIFE 核心与 Worker 源字符串；Worker 不带 URL/网络/文件系统调用，主线程不包含无界转换 fallback。打包许可包括 Mammoth、DOMPurify、fflate、xmldom 与实际传递依赖，许可内容不伪装成 README。
- [ ] Step 2：在模板 `EMBED_DOCX_BUNDLE` 标记注入闭包内 API。DOCX 独立 iframe `fdpdf-docx` 加 `sandbox=""`，可信工具区显示内容局限/取消，没有 PDF 下拉或图片/文本工具。close/newfile/pagehide 清 srcdoc、隐藏并 abort 任务；旧 generation 不改显示。
- [ ] Step 3：适配器可用后才在 `shared/formats.js` 注册 exact docx/20MiB，传输验证明确仅为初筛。`loadPdf` 的 DOCX 分支位于图片分支之前，先 `runDocxTask`，verified 回调只对当前任务 `setDownload` 原字节；sanitize 后才设 srcdoc。转换/清理失败保留已验证下载，传输/包失败无下载，提供原学校文件入口及重试；取消不自动重开。
- [ ] Step 4：真实 DOCX 的 Chromium/Firefox 集成渲染、表格跨度、两类图片自然尺寸、中文/脚注可见与文字选择、原字节下载；攻击包无执行、无外网、sandbox无token、CSP存在；关闭/重开/换文件/超时/CSP拒绝/失败下载策略。既有 userscript/PDF reader 回归；记录注入不等于真实管理器安装。两阶段审查后提交。

## 🔧 Task 7：扩展本地 DOCX 页面与构建同步

**Files:** Create `extension/docx-viewer.html`, `extension/docx-viewer.mjs`, `extension/docx-viewer.css`；modify `extension/catalog.js`, `extension/reader.mjs`, `scripts/build.mjs` 与验证脚本/测试。禁止扩大 host/GM 权限，不提审上架。

- [ ] Step 1：路由/包资源 RED，catalog docx -> `docx-viewer.html`；reader 只做传输初筛，不把普通 ZIP 视为通过。保留旧 readPdf MIME行为；旧 file-viewer 明确不接受 docx，防止误归图片。
- [ ] Step 2：独立页面保留可信标题、原文件、下载、状态、重试/取消与已有服务器授权约定；只合法 Canvas 路由和 final docx 文件名。包内 Worker 与主线程安全 API由同一 bundler产出，内嵌 sandbox空token iframe。verified 下载、失败策略、代次清理与油猴一致。
- [ ] Step 3：构建 Chromium/Firefox 输出含固定本地 Worker、核心、实际完整许可证，manifest/权限不扩大；ZIP 可复现。真实安装测试正文/图片/脚注/下载/恶意文档，旧格式回归。Windows Edge 和实际 Firefox 环境不可用时明确记录验证缺口，不能把 Chromium 注入替代对应验收。两阶段审查后提交。

## 🔧 Task 8：交付复核与准确记录

**Files:** README、隐私/验证/路线图/版本记录、工作流及需要修复的新增模块。

- [ ] 完整单测/检查/build/可复现包；两版真实浏览器与管理器核验；所有重要审查发现修复重审。记录工具环境、原始样例、离线请求证据及原字节对比；说明已验证与未验证范围。
- [ ] 更新候选版本为 1.3.0（DOCX功能，不表示已上架），注明20MiB与连续阅读限制，依赖许可、最终大小/哈希；油猴和扩展来自一致源码。
- [ ] 使用最终独立规格与代码复核；完成开发分支技能决定交付。用户没有要求本轮发布或上架，不创建Release/提审。此前推送授权不用于擅自合并未验收代码。

## ✅ 全程不变量

- [ ] 所有模块遵循批准规格的实际资源限额；不使用声明大小替代实际解压统计。
- [ ] 不只提取文字作为成功交付；正文、表格、图片与脚注必须真实显示。
- [ ] 默认无文档外部请求、无脚本、无页面同源权限；失败不修改 CSP。
- [ ] 原始字节独立保留；下载条件区分传输、包验证和转换状态。
- [ ] 两版接入均验收后才称本轮完整；没有商店提交或自动发布行为。
