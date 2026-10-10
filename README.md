# 复旦 eLearning 文件弹窗预览 · 油猴脚本版

在 eLearning 页面点击支持的文件名时，在当前页面弹窗预览 PDF、图片和文本，适用于网站自带预览不可用的情况。本项目与复旦大学及其 eLearning 平台无官方关联。

油猴脚本 **1.2.0** 支持图片、文本预览和 PDF 阅读器切换。下方安装链接跟随 `main` 更新；完整变更见 [1.2.0 说明](docs/releases/userscript-v1.2.0.md)。

## 选择版本

本项目保留两个版本，分别维护，不合并代码：

- **油猴脚本版（`main` 分支）**：需要 Tampermonkey，按下方步骤安装，在当前页面弹窗预览。
- **独立插件版（`feature/standalone-extension` 分支）**：无需 Tampermonkey，自带阅读器。[查看插件版源码与说明](https://github.com/sjy0630/fudan-elearning-pdf-preview/tree/feature/standalone-extension)；Edge 用户可直接[从微软商店安装](https://microsoftedge.microsoft.com/addons/detail/ibgcgppobifaogaodeimafhpmoonioch)。

普通 Edge 用户推荐商店插件版。请选择其中一种使用，不要同时启用同名油猴脚本和插件。

## 安装

安装步骤：

1. 确认 Chrome 中已安装并启用 Tampermonkey。
2. 点击[安装用户脚本](https://raw.githubusercontent.com/sjy0630/fudan-elearning-pdf-preview/main/elearning-pdf-preview.user.js)，在 Tampermonkey 的安装页面确认。
3. 重新加载 `elearning.fudan.edu.cn` 的作业页面。

较新的 Chrome 若在 Tampermonkey 中提示“允许运行用户脚本”，请按提示在该扩展的详情页启用对应选项，再刷新课程页面；本次隔离测试的 Chrome 155 / Tampermonkey 5.5.0 需要这一步。

也可在 Tampermonkey 中选择“添加新脚本”，把 [`elearning-pdf-preview.user.js`](elearning-pdf-preview.user.js) 的完整内容粘贴到编辑器并保存；已装同名脚本时使用管理器的更新检查，或编辑现有脚本，避免重复启用。普通使用者只需这一个文件，无需 Node.js、构建环境或额外资源。内置阅读器使安装文件增大，保存时请稍等。1.2.0 的验证范围和仍未覆盖的环境见[阅读器验证记录](docs/READER-VALIDATION.md)。

脚本约 4.85 MiB，已通过 Chromium / Firefox 整合测试，以及 Chrome for Testing 155 + Tampermonkey 5.5.0 的真实手动安装与合成页面验收。仍需真实学校课程试用；普通 URL 安装、升级权限提示和浏览器重启尚未验证，不代表所有浏览器或管理器都已兼容。

1.2.0 新增 `GM_getValue`、`GM_setValue` 权限，仅用来保存阅读器选择；如管理器提示权限变更，请核对后确认。未增加网站匹配或联网范围。

脚本元数据使用本仓库 `main` 的更新和下载地址。后续版本可通过脚本管理器检查更新。

## 支持格式与限制

| 文件 | 支持后缀 | 单文件大小上限 |
| --- | --- | --- |
| PDF | `.pdf` | 100 MiB |
| 图片 | `.png`、`.jpg`、`.jpeg`、`.webp` | 20 MiB |
| 文本与代码 | `.txt`、`.csv`、`.log`、`.json`、`.xml`、`.yaml`、`.yml`、`.c`、`.h`、`.cpp`、`.hpp`、`.py`、`.js`、`.ts`、`.java`、`.css`、`.sql`、`.sh` | 2 MiB |

1 MiB = 1,048,576 字节。图片另检查宽高：单边不得超过 16,384 像素，总像素不得超过 40,000,000。脚本检查文件类型与必要头部，再交由浏览器解码；损坏图像、动画 WebP、登录网页响应及超限文件会显示错误。HTML、SVG、GIF、Office 等未列出的格式不接管。

文本和代码始终作为纯文本显示，不执行脚本或 HTML，不做 Markdown 渲染或语法高亮。自动编码默认 UTF-8，并识别带 BOM 的 UTF-16；乱码或解码失败时可手动选择 UTF-8 或 GB18030。

## 使用

- 点击支持的文件名打开弹窗；页面原有下载图标、Ctrl/⌘ 点击等操作仍按网站或浏览器原行为处理。
- 图片支持放大、缩小、旋转 90°和适应窗口；文本支持编码选择、自动换行及复制。剪贴板不可用时会选中文本并提示手动复制。
- 成功读取、校验并准备好预览后，弹窗显示“下载文件”，保存读取到的原始字节；切换文本编码不会改变下载内容。
- 点“关闭”、弹窗外部或按 Escape 返回页面。关闭、重开和页面离开时会取消请求并释放临时资源。
- 预览失败时显示原因，并保留“打开原文件”入口；可通过学校原页面继续查看或下载。若文件读取或校验失败，不保证提供可用的本地文件下载。
- PDF 弹窗顶部可选择“浏览器自带”或“内置 PDF.js”，首次默认浏览器自带。选择会被记住；无法保存时会提示，但当前页面仍可使用。
- PDF.js 支持翻页、页码跳转、缩放、适合宽度和选中文字；加密文件可输入密码、重试或取消，密码不保存。暂不提供批注、编辑、表单填写、OCR 或全文搜索。
- 切换阅读器复用已读取的文件，不再请求文件；切入 PDF.js 从第 1 页开始。两种阅读器共用原字节下载。PDF.js 出错或取消密码输入后可手动“切换到浏览器自带”，不会自动改变保存的选择。

预览仍需从网站传输文件数据到浏览器，只是不主动保存到“下载”目录。浏览器自身可能使用缓存。

## 请求与隐私

脚本仅在 `https://elearning.fudan.edu.cn/` 运行，初始文件请求限于本站文件地址。先使用浏览器请求；仅在请求被浏览器阻止等情况下，尝试已有的 `GM_xmlhttpRequest` 读取回退。Tampermonkey 元数据中的既有 `@connect *` 用于学校文件服务的跨域重定向，本轮保持不变。

浏览器流式读取会检查声明大小和已读取字节数。管理器回退会检查响应头、进度与最终文件大小；能否在完整下载前提前中止取决于管理器是否提供及时的头部和进度事件。全部读取完成后仍会检查最终大小。

文件仅在本机浏览器处理，不上传到第三方预览服务；运行时不加载 CDN、远程脚本或 `@require` 资源。PDF.js 核心、后台处理代码及字体/CMap/解码资源已打包进脚本；不执行 PDF 内的脚本。不修改学校安全策略；若站点禁止后台任务，使用明确的错误提示和手动原生回退。

## 维护与验证

维护者修改 [`userscript/preview.template.js`](userscript/preview.template.js)、同目录的阅读器模块和 [`shared/formats.js`](shared/formats.js)，再生成可安装的单文件，不直接维护生成文件。开发环境需要 Node.js 22.13.0 或以上，推荐 Node.js 24。先安装锁定的开发依赖（PDF.js、esbuild、Playwright）；构建会把阅读器与资源打入脚本，浏览器测试还需准备测试浏览器。以下均为维护者的开发测试准备，普通用户安装单个脚本无需这些依赖。

在新的开发目录中安装依赖并运行：

```sh
npm ci
npm run build
npm run check
npm test
```

`build:userscript` 与 `check:userscript` 是对应的专用命令。`npm ci` 安装开发依赖，不会安装测试浏览器；首次运行浏览器检查前另行准备：

```sh
npx playwright install chromium firefox
npm run test:userscript
BROWSER_ENGINE=firefox npm run test:userscript
npm run test:reader
BROWSER_ENGINE=firefox npm run test:reader
```

`npm run test:userscript` 默认运行隔离 Chromium 注入检查，`BROWSER_ENGINE=firefox` 选择 Firefox；也可用 `BROWSER_EXECUTABLE` 指定已有的测试浏览器路径。

`test:reader` 使用有效的普通、中文、加密及损坏合成 PDF 检查阅读器；`test:pdfjs` 单独验证离线运行时和资源清理。准确的版本、结果及真实管理器与注入测试的区别见[阅读器验证记录](docs/READER-VALIDATION.md)。此前 1.1.0 的多格式证据单独保留在[旧版验证记录](docs/VALIDATION.md)，不能视为 1.2.0 全部兼容的证明。

后续计划见[路线图](docs/ROADMAP.md)；本轮范围见[阅读器选择设计](docs/superpowers/specs/2026-10-09-userscript-reader-choice-design.md)。

## 许可

本项目代码以 [MIT 许可证](LICENSE)发布。内嵌 PDF.js 及其资源保留各自许可证，完整第三方许可文本随生成脚本一起分发。

## Star 历史

两个版本属于同一个仓库，下图展示整个项目的 Star 增长趋势。

[![Star History Chart](https://api.star-history.com/svg?repos=sjy0630/fudan-elearning-pdf-preview&type=Date)](https://www.star-history.com/#sjy0630/fudan-elearning-pdf-preview&Date)

图表由第三方 Star History 服务生成，可能存在缓存延迟；若图片未加载，可点击查看图表页面。
