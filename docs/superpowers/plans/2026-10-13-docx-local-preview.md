# DOCX 本地预览实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 交付批准规格中的 DOCX 本地内容预览，先油猴、再扩展，保留 PDF/图片/文本及原字节下载。

**Architecture:** 独立的边界策略、ZIP 目录检查、受限流式解压、OOXML 预检与转换模块组成后台核心。输出经专用清理器进入无脚本、无同源权限的隔离预览；控制器独立保留原字节并管理取消、超时与过期结果。只有预览适配器验收后才注册 DOCX 到现有格式入口。

**Tech Stack:** Node.js 原生测试、现有 fflate/esbuild/Playwright，固定 pako 3.0.2 负责严格流式解压，候选 Mammoth 1.13.0、DOMPurify 3.4.17；依赖核对发行内容后固定安装。

---

## 当前执行约定（2026-10-24）

用户随后明确要求停止测试、推进上架，并于2026-10-24要求继续相关开发。以下早期任务中的测试步骤保留为历史计划，本轮不运行测试、压力样例或浏览器验证，也不将代码核对和构建称为测试通过。先完成尚缺的生命周期、隔离预览、油猴及扩展接入，生成候选安装包；保留实际未验证范围。上架授权已获得，但提交必须针对包含完整预览入口的安装包，提交审核与审核通过分别记录。

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

**Files:** Create `shared/docx-zip.mjs`, `tests/docx-zip.test.cjs`，修改 `package.json`/lock 固定 pako 3.0.2。fflate 保留用于样例压缩及转换副本打包；不修改格式入口。API 为 `scanDocxZip(input)`（返回有界目录条目）与 `expandDocxZip(input)`（返回 `Map<string, Uint8Array>`）。输入先调用 Task 1 的传输检查。

实施调查调整：fflate 0.8.3 会忽略 DEFLATE stored block 的 NLEN 补码，即使 CRC/字节正确仍接受损坏结构。改用已核对的 pako 3.0.2 流式解压（MIT AND Zlib），不自建 Huffman 解析器、不修改 node_modules、不改变产品范围或联网权限。该发行公开 `onStart(ZStream)`、`onData`、`ended`、`err`；保存 onStart 的流引用以核对 `total_in`，无需读取私有解码状态。

- [x] Step 1：先写测试并运行 `node --test tests/docx-zip.test.cjs`，确认缺少函数导致断言失败，再创建模块。

```javascript
test('ZIP scanner and bounded expander exist', async () => {
  const m = fs.existsSync(file) ? await import(pathToFileURL(file).href) : {};
  assert.equal(typeof m.scanDocxZip, 'function');
  assert.equal(typeof m.expandDocxZip, 'function');
});
```

- [x] Step 2：用 fflate `zipSync` 构造 STORE、DEFLATE、带目录和 UTF-8 名称的普通测试包；用 fflate `Zip`/`ZipPassThrough`/`ZipDeflate` 构造合法 signed descriptor 包，另构造 unsigned descriptor。先添加失败的行为测试，再逐项实现结构校验。EOCD 在尾部有界扫描，支持合法注释；核对磁盘、计数、中央目录大小/偏移、每条中央头与本地头、名称/标记/方法、数据范围、描述符 CRC 与大小。拒绝截断、ZIP64 extra/sentinel、多卷、加密及非 STORE/DEFLATE、重复名称、文件与目录冲突、重叠区与目录碰撞。

```javascript
const bytes = zipSync({'word/document.xml': strToU8('<document/>')}, {level: 6});
assert.equal(new TextDecoder().decode(expandDocxZip(bytes).get('word/document.xml')), '<document/>');
```

- [x] Step 3：名字禁止空段、绝对路径、反斜线、控制符、驱动器/URI/编码后逃逸及 `.`/`..`；允许普通相对层级及目录尾斜线。名字用严格 UTF-8 解码，普通 DOCX 的 ASCII 路径不受影响；非 ASCII 需 UTF-8 标志，Unicode Path 扩展必须与原始名称和 CRC 一致。额外字段长度有界，ZIP64 拒绝。
- [x] Step 4：pako `Inflate({raw:true,chunkSize:65536})` 每次最多输入 256 字节，`onData` 立即累计实际输出、CRC 和 XML/单项/全包预算；超限当场停止，不先全量 unzip。固定块输出不超过64KiB。核对 push 返回值/err/ended 与 onStart 的 `total_in === compressedSize`，拒绝未完成/尾随/损坏 NLEN 的压缩流。STORE 同样按实际字节与 CRC 验证。最终校对实际输出与声明大小，保留原输入不变。断言 1,000 项、20 MiB 单项、60 MiB 总量、4 MiB XML 边界；篡改声明大小的高压缩率炸弹必须在实际输出时拒绝。
- [x] Step 5：`node --test tests/docx-policy.test.cjs tests/docx-zip.test.cjs` 与语法检查通过；独立规格审查后代码质量审查，修复并重审；提交模块、测试和已批准的固定依赖变更。

Task 2 证据：提交 `b82fb351a05344d19cc7661076122e522a2ce11c`；缺失导出、结构/边界、六种损坏压缩流均记录 RED 后转 GREEN。主代理及独立审查运行51/51专用测试通过，两种审查无未解决问题；质量审查另测48种正常包、4,800次原生 zlib 对照变异及路径冲突探针，未发现漏检。尚不表示 OOXML/DOCX 验证通过。

## 🔧 Task 3：受限 OOXML 包验证

**Files:** Create `shared/docx-package.mjs`, `tests/docx-package.test.cjs`；依赖阶段允许修改 `package.json`/lock。固定安装 `@xmldom/xmldom@0.9.12`（MIT），供纯 Worker 兼容 XML 解析。API `verifyDocxPackage(input)` 返回 `{parts, xmlParts, documentPath, relationships, warnings}`，只有该函数成功才允许原字节下载。`parts` 是 Task 2 返回的有界 Map；`xmlParts` 是规范 UTF-8 XML 字符串的 Map（序列化已验证的 documentElement，不保留旧编码声明），供转换副本使用；`relationships` 是按关系文件路径索引的 Map，每项为 `{id,type,target,external,fragment?}` 数组，内部 target 为实际部件的 Map 键（安全 URI 别名唯一解析），外部 target 只作为字符串。

- [x] Step 1：先写缺失导出测试，确认失败。用 fflate 构造真正的最小 OOXML 结构进行单元测试：`[Content_Types].xml`、`_rels/.rels`、`word/document.xml`。正文根必须是 WordprocessingML `document` 且有唯一 `body`；接受标准 transitional 与 Strict 命名空间，二者由已核对 Mammoth 发行支持。

```javascript
assert.equal(typeof api.verifyDocxPackage, 'function');
const result = api.verifyDocxPackage(minimalWordZip);
assert.equal(result.documentPath, 'word/document.xml');
assert.ok(result.parts.has('word/document.xml'));
```

- [x] Step 2：`expandDocxZip` 后对所有 XML/关系部件执行严格有界 XML 解析（含内容类型指定为 XML、但没有 `.xml` 后缀的部件）；UTF-8/UTF-16 BOM 合法，声明编码与实际匹配，拒绝 DTD/ENTITY、解析警告/错误、未知实体、错误命名空间、重复属性与过度节点/嵌套。解析前用有界线性词法扫描统计标签与深度（忽略注释、CDATA、指令，正确跨过属性引号）；最多50,000标签、256层，再以 `onError` 任何等级立即抛错的 xmldom 解析。解析后用迭代遍历累计实际节点 <=50,000，不因递归溢出漏检。固定单 XML 4 MiB，不允许更名绕过 XML 限额。第一版明确只支持 XML 1.0；省略声明按1.0解释，其他版本报告不支持，避免去掉声明的转换副本改变版本语义。词法预检必须独立执行 XML/XMLNS 保留前缀及URI绑定规则；xmldom静默接受不合法绑定时不能视为有效XML。XML1.0不允许前缀解除绑定；合法默认命名空间清空、普通前缀重新绑定及固定xml绑定保持支持。
- [x] Step 3：检查内容类型的 Default/Override 重复及每个包部件类型；根关系唯一非外部 `officeDocument` 指向存在的非宏 Word 主文档，其 ContentType 精确为 `application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml`。拒绝宏/模板/其他 Office 主文档、vba 部件与宏关系；支持常规正文相对位置，转换阶段不得假定正文总是默认位置。
- [x] Step 4：每个 `.rels` 按对应源部件目录解析内部 Target，支持合法 `../` 和 OPC 包根 `/word/...`，归一化后仍须留在包内；拒绝 `//` 网络根、协议/驱动器/反斜线、编码逃逸、查询或非法片段，不请求任何外部 Target。包根目标只查询 Map 中部件，不解释为磁盘路径。内部指向必须存在；ID 唯一、关系根/属性合法。外部超链接保留警告，外部图片/对象给出缺失说明。不把外部目标视为本地文件。

内部片段只对标准 hyperlink 关系允许：先按字面 `#` 分割，再严格解码；编号最多256字符，仅 Unicode字母/数字/`_ . : -` 等 XML-ID 风格字符，不含控制符/路径/查询/另一个#。空路径指当前关系所属部件；其他关系类型不允许片段。`fragment` 独立保存，不静默丢弃。已验证 ZIP 名称建立有界安全 URI 别名索引，以兼容百分号编码或原始空格/Unicode名称，目标最终仍唯一指向现有实际Map键。后续预览清理全部href，不因该支持授予跳转权限。
- [x] Step 5：对公式、SmartArt/图表、修订、嵌入对象、altChunk、页眉页脚/浮动布局及不支持图片部件生成去重的中文内容局限提示。安全可见内容进入后续转换，不静默宣称完整。
- [x] Step 6：测试普通包、非默认正文位置、列表/脚注关系；错误类型/宏伪装、DTD/实体、畸形 XML、重复 IDs/types、内部逃逸/失踪目标、外部关系无读取、特性警告、输入不变；专用测试及旧测试通过，规格与质量审查后提交。

Task 3 证据：初次实现 `48f3e5f`，审查修复提交 `8a91d05`、`73e0040`、`4c91864e676379a345fe4964b2a911ba16c93942`。缺失导出与每组审查探针均先RED后GREEN；主代理专用88/88通过，独立规格37拒绝/11合法探针通过，质量复审34拒绝/17合法探针及完整178/178通过，语法与空白检查通过。两种审查无未解决问题；尚未接入转换器或DOCX入口。

## 🔧 Task 4：固定依赖、真实样例与 Worker 转换

**Files:** Create `shared/docx-convert.mjs`, `shared/docx-worker.mjs`, `scripts/docx-fixtures.mjs`, `tests/docx-convert.test.cjs`, `tests/fixtures/docx/*`；修改依赖及 lock。固定 Mammoth 1.13.0、DOMPurify 3.4.17，样例生成使用 docx 9.10.0 开发依赖，记录完整许可与发行完整性。API `convertDocx(input, {idPrefix,onVerified})` 异步返回 `{html, images, warnings}`；包验证只做一次，然后可选的可信内部回调 `onVerified` 发出下载可用事件。`images` 为 `{id,mime,bytes}` 数组，HTML 仅用 `docx-image-N` 标记，无真实资源 URL。

- [ ] Step 1：写缺失导出 RED，安装核对候选包。阅读发行 README/Security/License；Mammoth 仅使用固定本地 browser 入口，Worker 打包不得残留 Node 文件系统、HTTP、CDN 或动态远程执行。
- [ ] Step 2：依 DOCX 生成技能，用 docx-js 创建原创中文样例：标题、中文段落、粗斜体/上下标、嵌套编号、合并表格、脚注/尾注及 PNG/JPEG 至少两类图片。独立验证 OOXML 可打开，固定生成脚本、样例文件和许可；不是用 mock HTML 作为最终证据。

```javascript
const result = await convertDocx(new Uint8Array(await readFile(fixture)), {idPrefix:'test-docx-'});
assert.match(result.html, /中文正文/);
assert.match(result.html, /<table>/);
assert.equal(result.images.length, 2);
```

- [ ] Step 3：转换先完成包验证。Mammoth 配置 `includeEmbeddedStyleMap:false`, `externalFileAccess:false`, 每次命名空间 `idPrefix`；只收集内嵌图片，不读取外部目标。图片返回独立字节与内部标记，限制数量、字节、HTML UTF-8 大小；警告去重/有界。禁用嵌入样式映射以避免文档改变固定标签结构。

发行源码调查发现 Mammoth 的内嵌图片解析固定以 `word` 为基址、通用关系路径拼接不归一化 `..`。因此转换输入必须基于已验证 parts 的独立包副本，把内部关系 Target 重写为包根绝对路径，再以 STORE 生成临时转换容器（不得重新放宽原文件20MiB）。此副本总内容仍受60MiB实际解压限额；原字节始终不改。使用固定公共 `convertToHtml`，避免依赖未公开的转换内部接口；测试非默认正文路径和合法跨目录关系确保正文/图片/脚注不会因该上游局限丢失。

临时容器使用 fflate `Zip`/`ZipPassThrough` 的顺序 STORE 接口，不使用 `zipSync` 的内部普通对象文件字典（源码会将根部 `__proto__` 当成原型）；部件/关系/内容类型均用 Map。Mammoth 可使用固定普通公共模块；esbuild browser map 替换 unzip/外部 files 实现，以便锁文件与实际依赖/许可证对应。传入独立容器的 `arrayBuffer`（浏览器）及 `buffer: Uint8Array`（Node），绝不传 `path`/URL；最终 Worker 打包检查浏览器替换确实发生，无 Node IO 残留。

Mammoth 还固定按 UTF-8 读取 XML，且关系部件搜索仅匹配 transitional Type。因此转换副本把全部 `xmlParts` 写成 UTF-8，Strict 的已验证标准关系 Type 归一化为 transitional Type（正文命名空间保留，Mammoth 两者均支持）。重新检查副本各 XML4MiB/合计60MiB预算；不改变下载字节。单测覆盖 UTF-16 中文正文/关系和 Strict/非默认部件路径，避免安全入口通过但转换器无声丢失内容。

XML1.0预检的行结束处理只归一化CRLF/CR，保留合法U+0085/U+2028/U+2029。转换阶段须核对Mammoth实际锁定的嵌套XML解析器会否再次使用更宽的默认归一化；若会，转换副本必须以语义等价的字符引用保护这些字符（包括CDATA正文与属性），并覆盖真实转换结果。不能将不兼容的0.9解析器强行覆盖Mammoth的0.8依赖或修改node_modules；原始下载字节仍不改。

实施中的真实转换探针确认：Mammoth按字面正文basename寻找关系文件，也按字面扩展名寻找图片MIME。因此转换副本仅把关系部件名规范到实际已验证owner键的`dirname/_rels/basename.rels`（根固定`_rels/.rels`），使用旧实际键到副本键的有界Map同步改写内部Target和ContentTypes Override。不能增添重复别名、改变原始验证Map或下载字节；检查重命名冲突与项目/字节限额。必要时为已验证图片添加精确的MIME Override，避免合法编码扩展名或大写WebP丢图。转换HTML在返回前另检查50,000节点预算（元素/文本等及属性，不计项目临时包装），先线性标签界限再公共解析器计数；浏览器清理阶段仍独立检查实际DOM节点。
复核补充：Mammoth会按每次引用重复生成脚注/尾注，图片点击关系也会重复扩展同一URL。必须在调用转换器前有界检查实际引用放大量，并移除最终不提供导航的图片链接元数据，避免小容器生成数百MiB内容后才拒绝。沿用既定HTML/节点限额，不扩大策略导出；HTML字节检查采用有界、不分配完整编码副本的计数。回归包括普通重复脚注、尾注、精确50,000输出节点正例、超限负例，以及限堆子进程中的原始内存攻击复现；包验证事件仍先于后续转换限额错误。

转换工作量另按既定输出节点预算派生内部上限，覆盖重复但最终可能被合并/丢弃的源结构，避免仅统计可见文本遗漏中间树分配。源节点工作量上限取输出节点预算的四倍，为基本段落、run、文本元素及文本节点留出空间；复杂重复脚注可能提前提示超出预览复杂度，已验证原文件仍可下载。共享样式名称引起的警告字符串放大也须在Mammoth之前消除：固定语义映射不使用超过64字符的名称，转换副本可以把这些名称替换为短的非映射名称并发出固定提示，保留样式ID、定义和原始下载字节，不影响正常标题与样式转换。

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

实施前图片探针：原创204字节、两帧4×4的APNG被现有PNG头检查和Chromium实际解码接受，但返回尺寸只代表画布，不能证明多帧总解码预算。DOCX清理器须在原生解码前有界扫描PNG块并识别`acTL`/`fcTL`/`fdAT`，动画PNG按暂不支持图片显示占位与提示，不能按单帧预算接受。静态PNG/JPEG/WebP保持支持；这不修改旧图片预览行为或扩展格式范围。

图片总量按实际显示引用计数，不能让同一个内部标记重复出现绕过图片数或总像素限制；图片payload的ID必须唯一，字节总量独立检查。无引用的payload不得触发不必要的原生解码。所有原始src/srcset先移除，只有清理后的内部图片标记可恢复由验证字节生成的data URL。
- [ ] Step 5：节点 <=50,000，内容 HTML <=4MiB；ID 改为内部命名空间，不继承名称；colspan/rowspan 只受限正整数。第一版移除所有 href（含片段），保留脚注编号/内容并提示不提供跳转，避免 srcdoc 学校基址请求。外部网址仅可读文字。固定 srcdoc 包装含 CSP `default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`、UTF-8 与项目静态 CSS；内容没有活动样式或链接。

表格布局边界细化：显式跨度只接受十进制正整数1–1000；非法值移除并提示，不保留浏览器`rowspan=0`的延伸语义。超过1000的正整数，以及所有单元格`rowspan×colspan`的累计面积超过50,000时拒绝预览（仍保留已验证原文件下载），不静默截断巨大合并区域。累计边界复用输出节点预算，避免少量DOM元素生成巨量空白表格布局；不增加策略导出或改变普通合并表格支持。

字符往返验收：转换HTML中的`&#13;`经浏览器清理与序列化后，进入srcdoc再次解析时仍须保留语义CR；不得仅验证第一轮HTML解析。复用真实DOCX变体，连同DrawingML及HYPERLINK字段产生的href一起进入完整清理链测试。
- [ ] Step 6：Node 生命周期测试覆盖超时/取消/旧消息/异常/资源清理/原字节不变，真实 Chromium/Firefox 页面验证 sanitizer 恶意内容/URL/DOM污染/总像素/解码失败/最终 CSP。最终两版 iframe 必须另设 `sandbox=""`，不授予任何 token。两阶段审查后提交。

## 🔧 Task 6：先接入油猴单文件安装包

2026-10-24 实施进度：Task 5 两个源码模块已完成，提交 `cfcb7c8`，静态规格及质量核对通过。未执行测试；上方含运行验收的历史复合步骤不据此勾选通过。Task 6 现进入界面及打包接入。

Task 6 交付记录：源码及生成单文件已提交 `ae0a39d`；静态规格与质量核对通过，Node.js 24.19.0 构建退出码 0。生成 1.3.0 脚本 5,784,659 字节。没有运行测试或安装验收；Task 7 接入继续进行。

**Files:** Modify `userscript/preview.template.js`, `scripts/build-userscript.mjs`, `shared/formats.js` 与现有相关测试；create `scripts/bundle-docx.mjs`, `tests/docx-bundle.test.cjs`, `scripts/smoke-docx.mjs`。运行时依赖全部本地固定打包；许可内嵌。生成文件通过 generator 更新，不手工编辑。

- [ ] Step 1：缺失 DOCX API/打包标记 RED。`bundleDocx()` 用 esbuild 生成本地 browser IIFE 核心与 Worker 源字符串；Worker 不带 URL/网络/文件系统调用，主线程不包含无界转换 fallback。打包许可包括 Mammoth、DOMPurify、fflate、xmldom 与实际传递依赖，许可内容不伪装成 README。

pako 3.0.2 的发行 LICENSE 只列 MIT，Zlib 部分完整版权/限制在随包 `dist/pako.mjs.map` 的 `sourcesContent` 中（`../src/zlib/inflate.mjs` 开头注释）。构建必须从固定发行提取该完整 notice 与 MIT 一同内嵌/随扩展分发，不能只保留已被发行压缩器去掉注释的 `.mjs` 或包 metadata 许可证标签。其他库同样核对实际所含源许可证。

主代理实际Worker构建图包含JSZip的`dist/jszip.min.js`而非逐项lib依赖；该预打包文件另内含pako1.x、lie、immediate及setimmediate，不能仅凭esbuild顶层包列表漏掉这些notice。核对锁定发行的对应许可与源码，并包含pako1.x的完整MIT及Zlib声明（`node_modules/jszip/node_modules/pako/lib/zlib/inflate.js`开头），同时保留xmldom0.9.12和Mammoth内嵌0.8.15的声明。不引入新依赖或替换浏览器解析器来简化许可清单。
- [ ] Step 2：在模板 `EMBED_DOCX_BUNDLE` 标记注入闭包内 API。DOCX 独立 iframe `fdpdf-docx` 加 `sandbox=""`，可信工具区显示内容局限/取消，没有 PDF 下拉或图片/文本工具。close/newfile/pagehide 清 srcdoc、隐藏并 abort 任务；旧 generation 不改显示。
- [ ] Step 3：适配器可用后才在 `shared/formats.js` 注册 exact docx/20MiB，传输验证明确仅为初筛。`loadPdf` 的 DOCX 分支位于图片分支之前，先 `runDocxTask`，verified 回调只对当前任务 `setDownload` 原字节；sanitize 后才设 srcdoc。转换/清理失败保留已验证下载，传输/包失败无下载，提供原学校文件入口及重试；取消不自动重开。
- [ ] Step 4：真实 DOCX 的 Chromium/Firefox 集成渲染、表格跨度、两类图片自然尺寸、中文/脚注可见与文字选择、原字节下载；攻击包无执行、无外网、sandbox无token、CSP存在；关闭/重开/换文件/超时/CSP拒绝/失败下载策略。既有 userscript/PDF reader 回归；记录注入不等于真实管理器安装。两阶段审查后提交。

## 🔧 Task 7：扩展本地 DOCX 页面与构建同步

2026-10-24 交付补充：沿用已有 PDF/图片/文本内置示例模式，将现有 MIT 原创 `tests/fixtures/docx/normal.docx` 原样随扩展分发为固定 `demo.docx`，帮助页增加示例入口，供用户及商店审核员无需学校账号体验。只允许固定 demo 参数，不接受任意本地文件或 URL；本轮不运行该演示，不重新生成样例，不把提供演示等同于验证通过。

**Files:** Create `extension/docx-viewer.html`, `extension/docx-viewer.mjs`, `extension/docx-viewer.css`；modify `extension/catalog.js`, `extension/reader.mjs`, `scripts/build.mjs` 与验证脚本/测试。禁止扩大 host/GM 权限，不提审上架。

- [ ] Step 1：路由/包资源 RED，catalog docx -> `docx-viewer.html`；reader 只做传输初筛，不把普通 ZIP 视为通过。保留旧 readPdf MIME行为；旧 file-viewer 明确不接受 docx，防止误归图片。
- [ ] Step 2：独立页面保留可信标题、原文件、下载、状态、重试/取消与已有服务器授权约定；只合法 Canvas 路由和 final docx 文件名。包内 Worker 与主线程安全 API由同一 bundler产出，内嵌 sandbox空token iframe。verified 下载、失败策略、代次清理与油猴一致。
- [ ] Step 3：构建 Chromium/Firefox 输出含固定本地 Worker、核心、实际完整许可证，manifest/权限不扩大；ZIP 可复现。真实安装测试正文/图片/脚注/下载/恶意文档，旧格式回归。Windows Edge 和实际 Firefox 环境不可用时明确记录验证缺口，不能把 Chromium 注入替代对应验收。两阶段审查后提交。

## 🔧 Task 8：交付复核与准确记录

2026-10-24 交付记录：扩展源码提交 `d25d1c3`，静态规格与质量核对通过；已用 Node.js 24.19.0 构建 Chromium、Firefox 1.3.0 ZIP（退出码 0）。保留用户“不运行测试”约定，历史自动及浏览器验收项不勾选为已通过。Edge 包上传后显示 Complete，中英文说明与 DOCX 搜索词已保存；最终 Publish 后页面明确显示 Version 1.3.0 / In review，线上 1.1.1 仍为 Live。未推送或合并 GitHub，未发布 Release。详情与包校验值见 `docs/releases/v1.3.0-candidate.md`。

**Files:** README、隐私/验证/路线图/版本记录、工作流及需要修复的新增模块。

- [ ] 完整单测/检查/build/可复现包；两版真实浏览器与管理器核验；所有重要审查发现修复重审。记录工具环境、原始样例、离线请求证据及原字节对比；说明已验证与未验证范围。
- [ ] 更新候选版本为 1.3.0（DOCX功能，不表示已上架），注明20MiB与连续阅读限制，依赖许可、最终大小/哈希；油猴和扩展来自一致源码。
- [ ] 完成代码核对及候选安装包；按用户后续上架授权提交商店审核，准确区分本地构建、已提交和审核通过。没有新的GitHub合并或Release发布请求，不自动合并主分支或发布Release。

## ✅ 全程不变量

- [ ] 所有模块遵循批准规格的实际资源限额；不使用声明大小替代实际解压统计。
- [ ] 不只提取文字作为成功交付；正文、表格、图片与脚注必须真实显示。
- [ ] 默认无文档外部请求、无脚本、无页面同源权限；失败不修改 CSP。
- [ ] 原始字节独立保留；下载条件区分传输、包验证和转换状态。
- [ ] 两版接入完成状态、未运行的测试及商店提交状态分别说明，不把构建成功等同于运行验证或审核通过。
