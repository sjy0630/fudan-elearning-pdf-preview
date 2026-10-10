# 独立扩展验证记录

## 油猴多格式候选检查（2026-10-09）

油猴版本 1.1.0，单文件安装候选；未推送、发布或更新真实用户的脚本。

- 独立复跑 `node --test tests/userscript.test.cjs tests/userscript-build.test.cjs tests/formats.test.cjs`：24 项通过。覆盖共享格式、编码、精确链接识别、fetch 流式限制、GM 响应头/进度/最终大小限制、MIME 保留、中止与延迟回调，以及生成文件的一致性。
- `node scripts/build-userscript.mjs --check` 与 `node --check elearning-pdf-preview.user.js` 通过。最终脚本内嵌私有共享格式模块，无 `@require`，保留原更新地址及已有 GM 权限。
- Chromium 155.0.8059.12 与 Firefox 156.0 的最终注入式场景均通过：文本/脚本字面量安全显示，换行，UTF-16 与 GB18030 编码恢复，UTF-8 及 GB18030 原字节下载，三类图片解码/旋转/缩放/适应尺寸，损坏图像，HTML 登录响应，原文件入口，剪贴板成功或手动复制回退，模拟 GM 旧回调，关闭/重开、pagehide 和超时清理。Edge 本次未复跑：先前临时测试二进制已不存在，未重新安装。
- 当前浏览器脚本使用隔离页面、模拟文件响应和注入脚本；GM 与剪贴板部分场景使用模拟接口。不能替代真实 Tampermonkey 安装、升级、管理器沙箱、学校登录和 CDN 验证。
- PDF 占位样例仅用于检查 Blob/iframe 路由，不是有效 PDF 的实际渲染证据。图片、文本行为的验证不能扩大为原生 PDF 阅读器兼容承诺。

全套 `npm test` 本次得到 48 项通过、1 个本地化测试套件未完成：该套件重建扩展时在复制 `node_modules/pdfjs-dist/web/images/toolbarButton-viewsManagerToggle.svg` 到 `dist/chromium/vendor/images` 阶段长时间停滞，限时后终止该构建进程，套件因 SIGTERM 结束。文件所在目录有 iCloud 按需读取历史，但本轮未证明停滞的唯一原因。这不是源码断言失败，也不能算全套测试通过；本轮生成的 `dist` 不作为已验收安装包。旧版已发布 ZIP 不在此次油猴交付范围。

同日后续复跑：上述失败尝试保留为历史记录。当前资源可读取，未修改产品代码，完整 `npm test` 在约 71 秒后通过 **51/51**；`npm run check`、`npm run build`、`npm run verify:packages` 均通过，两个 1.2.0 包各核验 308 个资源。独立 Chromium 155 与 Firefox 156.0.1 再次各通过 20 项安装包检查，结果为 `output/playwright/ci/result.json`、`output/playwright/firefox/result.json`（本地、不纳入 Git）。1.1.1 两个 ZIP 的 SHA-256 与下文历史记录完全一致，未覆盖旧包。此前停顿不能再视为当前持续阻塞，但其唯一原因仍未确定。Firefox 此次启动前同样在读取本地依赖时等待较久，确认同一进程仍在推进后继续等待，最终完成，无需重启。

下文为历史扩展验证记录，不自动代表当前候选已重跑全部检查。

日期：2026-09-29；版本：1.1.0；目标：免 Tampermonkey 的首版独立扩展。

## 已验证

- `npm test`：16 项通过，覆盖原用户脚本、扩展链接识别、非本站拒绝、后台消息来源校验、精确域名授权、PDF 签名、权限错误、流式大小限制、超时清理及可重复 ZIP 打包。
- `npm run check`：业务脚本语法检查通过。
- `npm run build`：生成 Chromium 与 Firefox 清单、图标、内置阅读器及两个 ZIP。
- PDF.js 6.3.289 固定依赖；安装时 npm audit 报告 0 个已知漏洞。
- Chromium 155.0.8059.12（Chrome for Testing）：实际加载扩展，点击模拟 Canvas 文件名打开扩展阅读页；两页 PDF 的渲染、文本层、翻页、缩放、下载文件名验证通过。
- Microsoft Edge 154.0.4258.37：使用微软官方安装包校验后在临时目录运行，实际加载同一 Chromium 扩展包，重复上述检查通过。没有进行系统级安装。
- 两个浏览器的预览流程均未触发自动下载；点击“下载 PDF”产生预期下载。
- 原网页 Download 链接的点击事件未被扩展阻止；原文件行为由网站负责。
- 模拟 403 文件显示重新登录/无权限说明；跨域重定向无法读取时，显示真实重定向域名的单域授权按钮。浏览器实际授予的默认权限仅为 eLearning 域名和 webRequest。
- 公开截图使用本项目生成的两页演示 PDF，不包含课程资料或用户数据。
- 安装欢迎页和扩展菜单提供内置示例入口。在 Edge 154 隔离配置中断网测试通过：从欢迎页打开示例、渲染文字层并翻到第二页；没有发出 HTTP/HTTPS 请求。
- 演示模式对外部 source 参数的覆盖测试通过：始终读取固定的内置 PDF，隐藏课程原文件链接。普通课程文件的打开、翻页、缩放和下载回归验证通过。
- 两个 ZIP 均包含内置 demo.pdf；构建自动生成的 SHA256SUMS.txt 对两个安装包校验通过。

## 自动化跨系统验证（2026-09-29）

[GitHub Actions 完整运行记录](https://github.com/sjy0630/fudan-elearning-pdf-preview/actions/runs/36545334728)，被测代码提交 `c045d123a1cc5b2acc394cd1c6d5c14ff2063963`。三个任务全部成功：Linux Chromium、Windows Edge、跨系统安装包一致性检查。

| 环境 | 浏览器 | 结果 |
| --- | --- | --- |
| macOS 隔离配置 | Microsoft Edge 154.0.4258.37 | 本机 10 项端到端检查通过 |
| GitHub Windows Server 2025 | Microsoft Edge 153.0.4234.48，真实 Edge、有窗口模式 | 16 项单元测试与 10 项端到端检查通过 |
| GitHub Ubuntu | Playwright 1.63.0 的 Chromium 153，无窗口模式 | 16 项单元测试与 10 项端到端检查通过 |

端到端检查覆盖：默认权限、安装欢迎页、断网示例及外部参数不能替换示例、课程链接打开阅读器、文字层/翻页/缩放、预览零自动下载、主动下载文件名及实际 PDF 字节、原下载控件点击不被截获、403 登录提示、重定向后的单域授权提示、非学校来源拒绝。其中翻页/缩放与零自动下载合并为一项，共 10 项。

测试使用项目生成的两页 PDF 和模拟 Canvas 响应；其他 HTTP/HTTPS 请求一律阻断，记录中意外请求和页面脚本异常均为零。不使用真实账号，也不读取日常浏览器配置。每次运行只清理其新建的临时测试配置。

安装包不再依赖系统 `zip` 命令。两个系统均完成构建、包内 300 个资源检查、清单和权限检查、SHA256 校验及重复打包字节检查；随后对比 Windows 与 Linux 的两个 ZIP 校验值，完全一致。`.gitattributes` 统一文本换行，ZIP 固定文件顺序、时间与平台属性。

运行页的 `browser-evidence-*` 附件保存各系统的 `result.json` 与三张截图；`extension-packages-*` 保存两个测试 ZIP 与校验文件。附件可能按 GitHub 保留策略到期，之后可重新运行检查。这些包未经商店签名，不代表完成商店安装测试。

## Firefox 独立扩展实测

Firefox 补充实测：2026-09-29，在 macOS 使用官方 Firefox 156.0.1、geckodriver 0.37.1、Selenium 4.49.0，实际临时安装构建出的 Firefox ZIP，10 项检查通过：安装欢迎页、默认权限、离线资源示例及参数覆盖防护、模拟 Canvas 点击后渲染两页 PDF、翻页缩放且不自动下载、原下载按钮不被截获、主动下载的文件名和字节、403 提示、跨服务器定向授权提示、非学校来源拒绝。没有意外网络请求或请求拦截错误。

[Firefox 纳入自动检查后的运行记录](https://github.com/sjy0630/fudan-elearning-pdf-preview/actions/runs/36548044739)，代码提交 `cc24a8978b080394f53930488e37ba046c5455e0`：Linux Firefox 156.0 的同样 10 项检查全部通过，意外请求和拦截错误为零；Linux Chromium、Windows Edge 和跨系统包一致性任务也全部通过。`browser-evidence-firefox` 附件提供结果和截图。

视觉检查发现该 Linux runner 缺少中文字库，工具栏中文显示为缺字方框；英文 PDF 和功能检查正常。该截图只能作为功能验证证据，不能当作中文界面视觉验收或商店宣传图。macOS Firefox 和 Windows Edge 的中文界面截图正常；商店使用已准备的 Edge 截图。

Firefox 测试使用全新临时浏览器配置和生成的 PDF；通过 WebDriver BiDi 提供模拟响应，并使用不可连接的本地代理阻止未被拦截的外部请求。Firefox 138+ 的 `--allow-system-access` 仅提供给隔离的测试驱动，以读取扩展页面，不修改发布包的权限。主动下载后 Firefox 可能另开自己的本地 PDF 阅读页，测试将原下载按钮的检查放在主动下载之前，并按扩展阅读页地址识别新标签页。

开发者可运行 `npm run test:firefox`，Selenium 会获取官方稳定版浏览器与驱动；也可设置 `FIREFOX_BINARY`、`GECKODRIVER` 使用指定测试二进制。结果和截图保存在 `output/playwright/firefox/`。这仍然是临时安装测试，不是商店签名、永久安装或真实学校登录的验证。

## 尚待验证与发布

- 用户当前登录状态下的真实课程文件、学校实际 CDN 和多个不同课程。
- 跨域授权系统对话框的人工确认及授权后的真实 CDN 读取；目前已验证授权提示和权限范围、单元测试验证回退逻辑。
- Firefox 在更多操作系统和普通用户配置中的表现；目前独立扩展已有上述 macOS / Linux Firefox 156 实测，不再只依赖格式检查。
- 更多普通用户 Windows 10/11 设备上的安装体验（CI 的 Windows Server 结果不能替代全部桌面环境）、Firefox 的签名安装及 Mozilla 审核。
- 更多中国大陆校园/家庭网络下的商店访问与安装。已有同学反馈不开 VPN 成功安装，仅代表该次安装；扩展运行资源已全部内置，但不能据此保证所有网络可访问商店或所有课程 PDF 可读。

发布状态更新（2026-09-30）：Edge 已上架，[实际商店安装链接](https://microsoftedge.microsoft.com/addons/detail/ibgcgppobifaogaodeimafhpmoonioch)可供普通用户使用。Chrome Web Store 与 Firefox Add-ons 尚未上架。以上 2026-09-29 测试属于历史 1.1.0 证据，不自动证明当前 1.1.1 候选已通过同样的检查。当前候选尚未发布；公开 1.1.0 Release 链接保持有效。商店搜索情况见 [搜索观察](STORE-SEARCH.md)。

## 1.1.1 本地候选检查（2026-09-30）

- 新增真实构建本地化测试：实现前 Chromium 与 Firefox 两项均因缺少 `default_locale: zh_CN` 失败；实现后通过。
- `npm test`：18 项全部通过。新增测试验证两个构建清单的精确语言引用、两份语言目录的非空引用解析，以及构建文件与源码字节一致。
- `npm run check`、`npm run build`、`npm run verify:packages` 全部通过；每个 ZIP 302 个资源，检查权限、固定 Firefox ID、语言引用、语言文件源码字节、数字副本后缀、SHA-256 及重复打包一致性。
- 本节结果仅适用于本地候选，不代表已发布、Mozilla 签名或商店审核通过。

### 本轮浏览器与 Firefox 静态检查

被测扩展源码提交：`ea1291135cdb0f28d2752ed29b67c08ccebb1728`。运行环境 macOS，Node.js 25.8.2；以下为 2026-09-30 新运行结果，不沿用历史结论。

| 浏览器 | 最终结果 | 本地结果目录（不纳入 Git） |
| --- | --- | --- |
| Edge 154.0.4258.37，隔离临时配置 | 10 / 10 通过 | `output/playwright/edge-1.1.1/` |
| Chrome for Testing 155（缓存 Chromium 1247） | 10 / 10 通过 | `output/playwright/chromium-1.1.1/` |
| Firefox 156.0.1，geckodriver 0.37.1 | 10 / 10 通过 | `output/playwright/firefox-1.1.1/` |

检查内容包括离线示例、模拟课程 PDF、文字层/翻页/缩放、预览不自动下载、主动下载文件名和字节、原下载控件、403 提示、单域授权提示及拒绝外部来源。最终报告中的意外请求、页面异常（Chromium/Edge）和拦截异常（Firefox）均为零。仍未测试真实课程登录、真实 CDN 授权或签名安装；未重新执行 Windows/Linux CI，也未逐语言做浏览器元数据显示验收。

运行过程限制：沙盒内 Firefox 不能监听本地测试端口，Edge 启动失败；获准在沙盒外使用全新隔离配置后完成。默认 Playwright Chromium 1243 缓存不存在，改用已缓存的 Chromium 1247，未新下载浏览器。一次 Edge 重跑与会重建 `dist` 的 `npm test` 重叠，在“原下载控件”检查中出现页面数 `6 !== 5`；该次事件未被默认阻止的断言通过。停止并行重建后，独立复跑 10 项通过；失败报告保留于 `output/playwright/edge-1.1.1-interrupted/`，但没有据此断言页面数变化的唯一原因。后续应串行运行构建与浏览器测试。

`web-ext 10.7.0 lint --source-dir dist/firefox --output json`：0 错误、0 notices、8 条警告，均位于打包的 PDF.js legacy 资源。原始报告见 [firefox-lint-1.1.1.json](reports/firefox-lint-1.1.1.json)，解释见 [Firefox 提交清单](FIREFOX-SUBMISSION.md)。这不等于 Mozilla 签名或人工审核通过。

本轮最终包 SHA-256（与 `dist/SHA256SUMS.txt` 一致）：

```text
92f711f8af41509446ded0e780f830fa1d3dfc94e2266166759b9f9a02112f0f  fudan-elearning-pdf-preview-chromium-1.1.1.zip
deaf9cc7240b61b65178a4f68565687db27dcb7b430e1e97bddafe1003fe7b5e  fudan-elearning-pdf-preview-firefox-1.1.1.zip
```

### 固定源码快照独立重建

2026-09-30 从 `7bb035640e7ddb1615e7562918f684c30413a9c5` 导出的源码 ZIP 在新目录 `/private/tmp/fudan-source-audit.uEw4QW` 解压测试，不复用原工作目录的 `node_modules`。使用已有 npm 缓存安装锁定依赖（忽略安装脚本及可选依赖），18 项测试、语法检查、双浏览器构建和包校验通过。`cmp` 分别确认新生成的两个 ZIP 与原 1.1.1 候选包逐字节一致。此证据证明该快照在本次环境中可复现，不扩大为跨系统或无缓存离线构建保证。

固定源码 ZIP、哈希和审核员重建说明见 [Firefox 提交清单](FIREFOX-SUBMISSION.md#已准备的固定源码快照)。仅准备本地材料，未签名或提交 Firefox，未正式提交 Edge 草稿。
