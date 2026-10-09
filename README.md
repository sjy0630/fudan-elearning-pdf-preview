# 复旦 eLearning 文件弹窗预览 · 油猴脚本版

在 eLearning 页面点击支持的文件名时，在当前页面弹窗预览 PDF、图片和文本，适用于网站自带预览不可用的情况。本项目与复旦大学及其 eLearning 平台无官方关联。

当前分支 `feature/userscript-multiformat` 是 **1.1.0 本地未发布候选**。多格式功能只在此候选中；下方公开安装链接仍指向 `main` 的既有 PDF 版，尚未更新为本候选。PDF 当前固定使用浏览器自带阅读器，阅读器切换尚未实现。

## 选择版本

本项目保留两个版本，分别维护，不合并代码：

- **油猴脚本版（公开 `main` 分支）**：需要 Tampermonkey，按下方步骤安装，在当前页面弹窗预览。本分支单独准备油猴多格式更新。
- **独立插件版（`feature/standalone-extension` 分支）**：无需 Tampermonkey，自带阅读器。[查看插件版源码与说明](https://github.com/sjy0630/fudan-elearning-pdf-preview/tree/feature/standalone-extension)；Edge 用户可直接[从微软商店安装](https://microsoftedge.microsoft.com/addons/detail/ibgcgppobifaogaodeimafhpmoonioch)。

普通 Edge 用户推荐商店插件版。请选择其中一种使用，不要同时启用同名油猴脚本和插件。

## 安装

公开版安装步骤（仍为 `main` 的既有 PDF 版）：

1. 确认 Chrome 中已安装并启用 Tampermonkey。
2. 点击[安装用户脚本](https://raw.githubusercontent.com/sjy0630/fudan-elearning-pdf-preview/main/elearning-pdf-preview.user.js)，在 Tampermonkey 的安装页面确认。
3. 重新加载 `elearning.fudan.edu.cn` 的作业页面。

本地候选如需试用，可在 Tampermonkey 中选择“添加新脚本”，把本分支 [`elearning-pdf-preview.user.js`](elearning-pdf-preview.user.js) 的完整内容粘贴到编辑器并保存。普通使用者只需这一个文件，无需 Node.js、构建环境或额外资源。候选尚未验证真实管理器安装及升级流程，详见[验证记录](docs/VALIDATION.md)。

脚本元数据保留原来的 `main` 更新地址和下载地址。准备这个本地分支不会自动更新已安装脚本，也不代表多格式候选已经发布。

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
- 预览失败时显示原因，并保留“打开原文件”入口；可通过学校原页面继续查看或下载。失败状态不保证提供可用的本地文件下载。
- PDF 通过浏览器自带阅读器显示，其界面和行为由浏览器决定。目前没有阅读器选择菜单或内置 PDF.js。

预览仍需从网站传输文件数据到浏览器，只是不主动保存到“下载”目录。浏览器自身可能使用缓存。

## 请求与隐私

脚本仅在 `https://elearning.fudan.edu.cn/` 运行，初始文件请求限于本站文件地址。先使用浏览器请求；仅在请求被浏览器阻止等情况下，尝试已有的 `GM_xmlhttpRequest` 读取回退。Tampermonkey 元数据中的 `@connect *` 用于学校文件服务的跨域重定向，并未增加新的管理器权限。

浏览器流式读取会检查声明大小和已读取字节数。管理器回退会检查响应头、进度与最终文件大小；能否在完整下载前提前中止取决于管理器是否提供及时的头部和进度事件。全部读取完成后仍会检查最终大小。

文件仅在本机浏览器处理，不上传到第三方预览服务；运行时不加载 CDN、远程脚本或 `@require` 资源。

## 维护与验证

维护者修改 [`userscript/preview.template.js`](userscript/preview.template.js) 和 [`shared/formats.js`](shared/formats.js)，再生成可安装的单文件，不直接维护生成文件。构建与单元测试只使用 Node.js；注入式浏览器检查另需锁定的 Playwright 开发依赖和测试浏览器。

在新的开发目录中安装依赖并运行：

```sh
npm ci
npm run build
npm run check
npm test
```

`build:userscript` 与 `check:userscript` 是对应的专用命令。`npm run test:userscript` 运行隔离 Chromium 注入检查；可用 `BROWSER_ENGINE=firefox` 选择 Firefox，用 `BROWSER_EXECUTABLE` 指定已有的测试浏览器路径。

当前 24 项单元测试及 Chromium / Firefox 注入式检查的证据和边界见[验证记录](docs/VALIDATION.md)。页面注入和模拟 GM 接口不能替代真实 Tampermonkey、学校登录及 CDN 测试；PDF 占位样例仅验证 Blob/iframe 路由，不代表真实 PDF 已渲染。

后续计划见[路线图](docs/ROADMAP.md)；[阅读器选择设计](docs/superpowers/specs/2026-10-09-userscript-reader-choice-design.md)仍待用户复核。

## 许可

本项目以 [MIT 许可证](LICENSE)发布。

## Star 历史

两个版本属于同一个仓库，下图展示整个项目的 Star 增长趋势。

[![Star History Chart](https://api.star-history.com/svg?repos=sjy0630/fudan-elearning-pdf-preview&type=Date)](https://www.star-history.com/#sjy0630/fudan-elearning-pdf-preview&Date)

图表由第三方 Star History 服务生成，可能存在缓存延迟；若图片未加载，可点击查看图表页面。
