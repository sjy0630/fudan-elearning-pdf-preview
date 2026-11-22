# 复旦 eLearning 文件预览

在 eLearning 页面点击支持的文件名即可预览课件，适用于网站自带预览不可用的情况。本项目与复旦大学及其 eLearning 平台无官方关联。

油猴脚本 **1.2.0** 支持图片、文本预览和 PDF 阅读器切换。下方安装链接跟随 `main` 更新；完整变更见 [1.2.0 说明](docs/releases/userscript-v1.2.0.md)。

当前开发分支为 **1.4.0 候选版**：油猴和独立扩展同步增加 `.pptx` 与真正的旧版 `.ppt` 静态预览，并保留 DOCX 功能。油猴版还支持拖动、调整弹窗大小、最大化还原和独立 PDF 标签页；阅读器选择已合并到顶部页眉。此分支的更新不会自动替换 `main`、商店版或已安装脚本。范围和验证边界见 [1.4.0 记录](docs/releases/v1.4.0-candidate.md)。上次记录的 Edge 状态为 2026-10-24 的 1.3.0 In review / 1.1.1 Live，本轮未重新查询商店状态。

体验上述功能可[安装开发分支的油猴脚本](https://raw.githubusercontent.com/sjy0630/fudan-elearning-pdf-preview/refs/heads/feature/docx-local-preview/elearning-pdf-preview.user.js)。已装同名脚本时确认更新，然后刷新课程页面；不要重复启用两份脚本。下方常规安装入口仍指向 `main`。

## 选择版本

本仓库同时提供两个独立安装方式，共用格式校验，不要同时启用：

- **油猴脚本版（`main` 分支）**：需要 Tampermonkey，按下方步骤安装，在当前页面弹窗预览。
- **独立插件版（`extension/` 目录）**：无需 Tampermonkey，自带阅读器。Edge 用户可直接[从微软商店安装](https://microsoftedge.microsoft.com/addons/detail/ibgcgppobifaogaodeimafhpmoonioch)。[安装与构建说明](docs/EXTENSION.md)。本分支为 1.4.0 候选；商店和已发布安装包不会随源码修改自动升级，具体已发布版本以商店及 Releases 为准。

普通 Edge 用户推荐商店插件版。请选择其中一种使用，不要同时启用同名油猴脚本和插件。

## 安装

以下是油猴脚本版的安装和使用说明；普通 Edge 用户优先使用上方商店入口。

安装步骤：

1. 确认 Chrome 中已安装并启用 Tampermonkey。
2. 点击[安装用户脚本](https://raw.githubusercontent.com/sjy0630/fudan-elearning-pdf-preview/main/elearning-pdf-preview.user.js)，在 Tampermonkey 的安装页面确认。
3. 重新加载 `elearning.fudan.edu.cn` 的作业页面。

较新的 Chrome 若在 Tampermonkey 中提示“允许运行用户脚本”，请按提示在该扩展的详情页启用对应选项，再刷新课程页面；本次隔离测试的 Chrome 155 / Tampermonkey 5.5.0 需要这一步。

也可在 Tampermonkey 中选择“添加新脚本”，把 [`elearning-pdf-preview.user.js`](elearning-pdf-preview.user.js) 的完整内容粘贴到编辑器并保存；已装同名脚本时使用管理器的更新检查，或编辑现有脚本，避免重复启用。普通使用者只需这一个文件，无需 Node.js、构建环境或额外资源。内置阅读器使安装文件增大，保存时请稍等。1.2.0 的验证范围和仍未覆盖的环境见[阅读器验证记录](docs/READER-VALIDATION.md)。

此前 1.2.0 脚本约 4.85 MiB，已通过 Chromium / Firefox 整合测试，以及 Chrome for Testing 155 + Tampermonkey 5.5.0 的真实手动安装与合成页面验收。这些是旧版证据，不能代替 1.4.0 的真实管理器安装验收。本轮 PPT/PPTX 的隔离浏览器检查与未覆盖环境见 [1.4.0 记录](docs/releases/v1.4.0-candidate.md)。

1.2.0 新增 `GM_getValue`、`GM_setValue` 权限，仅用来保存阅读器选择；如管理器提示权限变更，请核对后确认。未增加网站匹配或联网范围。

脚本元数据使用本仓库 `main` 的更新和下载地址。后续版本可通过脚本管理器检查更新。

## 支持格式与限制

| 文件 | 支持后缀 | 单文件大小上限 |
| --- | --- | --- |
| PDF | `.pdf` | 100 MiB |
| 图片 | `.png`、`.jpg`、`.jpeg`、`.webp` | 20 MiB |
| 文本与代码 | `.txt`、`.csv`、`.log`、`.json`、`.xml`、`.yaml`、`.yml`、`.c`、`.h`、`.cpp`、`.hpp`、`.py`、`.js`、`.ts`、`.java`、`.css`、`.sql`、`.sh` | 2 MiB |
| Word 内容（开发候选） | `.docx` | 20 MiB |
| 幻灯片（1.4.0 开发候选） | `.pptx`、`.ppt`（PowerPoint 97–2003） | 50 MiB、500 页 |

1 MiB = 1,048,576 字节。图片另检查宽高：单边不得超过 16,384 像素，总像素不得超过 40,000,000。脚本检查文件类型与必要头部，再交由浏览器解码；损坏图像、动画 WebP、登录网页响应及超限文件会显示错误。HTML、SVG、GIF、DOC、DOCM、PPTM、XLSX 等未列出的格式不接管。

PPT / PPTX 逐页显示文字、常见形状、PNG/JPEG/静态 WebP 图片及基本表格，提供翻页、页码跳转、缩放和适应窗口。文件在本地后台解析，不上传课件，不需要 Office。预览为静态内容，不执行宏和嵌入对象，不播放动画或音视频，不读取外部图片。字体和复杂布局可能不同；旧版矢量图片、单张超过 20 MiB 的图片等会省略并显示提示。加密、损坏或超限文件会报错，可取消、重试或打开原文件。

DOCX 以连续阅读区显示正文、列表、表格、脚注/尾注和常见内嵌图片，不还原 Word 分页、字体或复杂布局。不支持的内容会提示；可取消、重试或打开原文件。包检查完成后提供原字节下载，即使后续转换或显示准备失败仍保留该下载。全部在浏览器本地处理，依赖随安装包分发，不上传到在线 Office 服务。新界面的浏览器行为尚未验证，详细状态见 [DOCX 记录](docs/DOCX-VALIDATION.md)。

文本和代码始终作为纯文本显示，不执行脚本或 HTML，不做 Markdown 渲染或语法高亮。自动编码默认 UTF-8，并识别带 BOM 的 UTF-16；乱码或解码失败时可手动选择 UTF-8 或 GB18030。

## 使用

- 点击支持的文件名打开弹窗；页面原有下载图标、Ctrl/⌘ 点击等操作仍按网站或浏览器原行为处理。
- 此分支的油猴弹窗可拖动标题栏移动，拖动四边或四角调整大小；双击标题栏或点击“最大化 / 还原”切换窗口大小，“重置窗口”恢复居中。位置和大小在当前页面内保留，刷新页面后重置。移动和调整窗口不会重新读取文件；PDF.js 会保留当前页码，并在适合宽度时尽量保持阅读位置。
- PDF 读取完成后，点击“新标签页”可用浏览器自带阅读器独立查看，不会再次请求课件。关掉弹窗或离开课程页面后，该标签页仍可继续查看；它是临时预览页，刷新或关掉它后需重新从课程页面打开。新标签页不沿用弹窗内 PDF.js 的阅读位置。
- 也可按 Tab 聚焦文件标题，再用方向键移动窗口，Shift + 方向键调整大小。窗口会限制在浏览器可视范围内。
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
npm run test:window
BROWSER_ENGINE=firefox npm run test:window
```

`npm run test:userscript` 默认运行隔离 Chromium 注入检查，`BROWSER_ENGINE=firefox` 选择 Firefox；也可用 `BROWSER_EXECUTABLE` 指定已有的测试浏览器路径。

`test:window` 使用本地合成 PDF，检查移动、调整大小、最大化还原、键盘操作、阅读位置和独立标签页。它不访问真实课件，也不代表已在用户的 Tampermonkey 中安装验收。

`test:reader` 使用有效的普通、中文、加密及损坏合成 PDF 检查阅读器；`test:pdfjs` 单独验证离线运行时和资源清理。准确的版本、结果及真实管理器与注入测试的区别见[阅读器验证记录](docs/READER-VALIDATION.md)。此前 1.1.0 的多格式证据单独保留在[旧版验证记录](docs/VALIDATION.md)，不能视为 1.2.0 全部兼容的证明。

`npm run test:presentations` 检查本地 PPT / PPTX 样例在两版界面中的翻页、缩放、原字节下载和关闭清理；`PRESENTATION_BROWSER=firefox` 选择 Firefox。这是隔离浏览器检查，不等同于商店审核或真实管理器安装。

后续计划见[路线图](docs/ROADMAP.md)；本轮范围见[PPT / PPTX 设计](docs/superpowers/specs/2026-10-29-presentation-preview-design.md)。

## 许可

本项目代码以 [MIT 许可证](LICENSE)发布。内嵌 PDF.js、DOCX 与 PPT / PPTX 依赖及其资源保留各自许可证，完整第三方许可文本随生成脚本及扩展安装包分发。

## Star 历史

两个版本属于同一个仓库，下图展示整个项目的 Star 增长趋势。

[![Star History Chart](https://api.star-history.com/svg?repos=sjy0630/fudan-elearning-pdf-preview&type=Date)](https://www.star-history.com/#sjy0630/fudan-elearning-pdf-preview&Date)

图表由第三方 Star History 服务生成，可能存在缓存延迟；若图片未加载，可点击查看图表页面。
