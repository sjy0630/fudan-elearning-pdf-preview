# Firefox 1.1.1 提交准备清单

状态（2026-09-30）：仅准备本地候选及审核材料。未登录 Mozilla 账号、接受协议、签名或提交；Firefox 尚无面向普通用户的永久安装链接。未签名 ZIP 只能用于临时加载测试，重启后需要重新加载。

## 包与身份

- [ ] 使用固定扩展 ID `fudan-elearning-pdf-preview@sjy0630`，不可为此次更新另换 ID。
- [ ] 核对版本 `1.1.1`、Manifest V3、Firefox 最低版本 `142.0`。
- [ ] 待所有者审阅的包：`dist/fudan-elearning-pdf-preview-firefox-1.1.1.zip`。该包尚未发布；公开 GitHub Release 保持 1.1.0。
- [ ] 在仓库根目录运行 `shasum -a 256 dist/fudan-elearning-pdf-preview-firefox-1.1.1.zip`，与 `dist/SHA256SUMS.txt` 核对；构建改变后重新核对，不沿用旧哈希。

## 可复现构建与源码

### 已准备的固定源码快照

2026-09-30 已从提交 `7bb035640e7ddb1615e7562918f684c30413a9c5` 导出本地审核源码包：`dist/fudan-elearning-pdf-preview-source-1.1.1-7bb0356.zip`。该文件是源码，不能作为浏览器扩展安装。SHA-256：`4d2195fd1f7b79e945afc8f1eadd969ed3a7bc826a5cd1273b98fbed43a5bcf1`。

已在全新临时目录解压，使用 Node.js 25.8.2 运行 `npm ci --offline --ignore-scripts --omit=optional --no-audit --no-fund`，再执行下方 test/check/build/verify 命令。18 项测试通过，两个浏览器包各 302 项资源校验通过，重建 ZIP 与本地 1.1.1 候选包逐字节相同。`--offline` 依赖本机已有 npm 缓存；审核员无缓存时应使用下面的联网安装命令，不能据此宣称源码能在任意电脑离线构建。

源码包含 63 个 ZIP 条目（包含目录），仅导出该提交的跟踪文件；路径检查通过，不含 `.git`、`node_modules`、`.env`、构建输出或浏览器测试配置。该快照尚未上传 Mozilla；后续若修改扩展源码或依赖，必须重新生成、核对安装包和源码包。文档后续补记不改变这个固定快照的身份。

需要 Node.js 22.13.0 或更高版本（推荐 24），在干净源码快照根目录运行：

```sh
npm ci --ignore-scripts --omit=optional
npm test
npm run check
npm run build
npm run verify:packages
```

- [ ] 保存最终提交 SHA，并提供该提交的完整源码快照，包含 `package.json`、`package-lock.json`、`scripts/`、`extension/`、测试与许可证。源码包不应包含账号、课程文件、日常浏览器配置或 `node_modules/`。
- [ ] 可用 `git archive --format=zip --output=../fudan-elearning-pdf-preview-source-1.1.1.zip HEAD` 导出已提交快照；先确认 HEAD 包含最终审核的全部修改。GitHub 自动生成的源码 ZIP 不是可直接安装的扩展 ZIP。
- [ ] 记录实际运行环境、构建结果及包校验值。验证脚本检查权限、两份语言目录、源文件字节、无 iCloud 数字副本后缀、资源完整性、校验值及重复打包一致性。

## PDF.js 来源及许可证

- 固定 npm 依赖：`pdfjs-dist` **6.3.289**；来源为 [Mozilla PDF.js](https://github.com/mozilla/pdf.js) 的 [npm 发布包](https://www.npmjs.com/package/pdfjs-dist/v/6.3.289)，完整性固定在锁文件中。
- 构建直接复制官方 `legacy/build/pdf.mjs`、`legacy/build/pdf.worker.mjs`、viewer CSS、CMaps、标准字体、WASM 和图片资源；未使用的 `quickjs-eval` 资源不分发。
- PDF.js 采用 Apache-2.0，原许可证随包置于 `vendor/PDFJS-LICENSE.txt`；本项目 MIT 许可证位于 `LICENSE.txt`。
- worker 指向包内本地文件，执行代码不从 CDN 获取。扩展 CSP 不允许 `unsafe-eval`；阅读器设置 `isEvalSupported: false` 且不启用 PDF JavaScript 脚本执行。
- 静态检查可能对官方 legacy 构建的兼容性 polyfill、Function、document.write 和动态 import 报警。应提交实际检查器版本、原始报告及解释，不能将警告忽略或检查通过称为 Mozilla 人工批准。

## 审核员操作与权限

### 本轮静态检查附件

2026-09-30 使用 **web-ext 10.7.0** 对本地 1.1.1 的 `dist/firefox` 执行 `web-ext lint --source-dir dist/firefox --output json`，结果 **0 错误、0 notices、8 条警告**。[原始 JSON 报告](reports/firefox-lint-1.1.1.json)随本材料保存；对应 ZIP 哈希见 [验证记录](VALIDATION.md)。

| 文件 | 行号 | 检查器警告 |
| --- | --- | --- |
| `vendor/pdf.mjs` | 1476 | `DANGEROUS_EVAL`：Function 构造器 |
| `vendor/pdf.mjs` | 2471、2491 | `UNSAFE_VAR_ASSIGNMENT`：兼容代码的 document.write |
| `vendor/pdf.mjs` | 22958 | `UNSAFE_VAR_ASSIGNMENT`：动态 import |
| `vendor/pdf.worker.mjs` | 1418 | `DANGEROUS_EVAL`：Function 构造器 |
| `vendor/pdf.worker.mjs` | 2359、2379 | `UNSAFE_VAR_ASSIGNMENT`：兼容代码的 document.write |
| `vendor/pdf.worker.mjs` | 15548 | `UNSAFE_VAR_ASSIGNMENT`：动态 import |

这些位置来自固定版本上游依赖，未为消除警告而修改 vendor 文件。审核时提供上游来源、锁文件和构建步骤，并说明 CSP、`isEvalSupported: false` 与本地 worker 路径。警告说明不代替 Mozilla 对依赖及执行路径的审查。当前未申请签名，未正式提交。

### 所有者提交前确认

- [ ] 提供 [审核员指南](REVIEWER-GUIDE.md) 和欢迎页内“先体验示例 PDF”：无需学校账号或网络，可测试生成的两页 PDF、文字选择、翻页、缩放和主动下载。不得向学生索取账号或提交真实课程资料。
- [ ] 说明模拟课程测试与真实学校登录测试的边界；自动化结果见 [验证记录](VALIDATION.md)。
- [ ] 默认网站访问仅 `https://elearning.fudan.edu.cn/*`；`webRequest` 只识别文件重定向，不修改请求。可选 `https://*/*` 仅供用户在阅读器看到具体文件服务器域名后主动授予单域权限。
- [ ] 不申请 tabs、history、cookies、downloads、nativeMessaging；不收集浏览记录、密码或文件内容，不上传文件到第三方预览服务，无统计代码。Firefox 清单声明 `data_collection_permissions.required: ["none"]`。
- [ ] 填入公开隐私页：https://github.com/sjy0630/fudan-elearning-pdf-preview/blob/feature/standalone-extension/docs/PRIVACY.md 。
- [ ] 使用 [中英文商店文案](STORE-LISTING.md)，在商店后台单独配置语言；包内元数据语言不会自动创建商店语言条目，当前 UI 仍为中文。

账号验证、协议接受、最终上传和签名均由所有者另行操作。只有 Mozilla 签名和审核完成后，才能提供对应的正式安装链接。
