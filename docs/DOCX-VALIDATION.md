# DOCX 本地预览验证记录

2026-10-13。用户已批准实施，开发分支 `feature/docx-local-preview`。本文只记录实测证据；尚未完成 DOCX 阅读器，未提交扩展商店或发布 Release。

## 当前已验证

传输入口模块提交 `41d847bb0d38a6a9eac2860cd1895904f922d268`。首次测试因缺少 `DOCX_LIMITS` 失败，传输行为测试因缺少 `checkDocxTransfer` 失败；实现后专用测试 15/15 通过，语法检查通过。主代理、独立规格审查和质量审查分别复核，未发现未解决问题。

检查涵盖所有固定限额、只读字节视图与偏移、20 MiB 精确边界、MIME、登录页面、OLE 和 ZIP 签名、纯模块无 DOM/网络/文件系统副作用。ZIP 传输签名不是 DOCX 真实性证明，后续包验证尚在实施。

主代理回归既有测试及 Task 1（不纳入当时正在刻意 RED 的 ZIP 开发测试）：105/105 通过，`npm run check` 两版检查通过。新 DOCX 界面尚未接入，这不是 DOCX 功能验收。

ZIP 核心提交 `b82fb351a05344d19cc7661076122e522a2ce11c`；主代理新运行 policy/ZIP 专用测试 51/51 通过，覆盖合法 STORE/DEFLATE/描述符、结构攻击、实际解压量与严格压缩数据负例。独立规格及质量审查均通过；质量审查另测48种正常包、4,800次原生 zlib 对照变异及路径冲突探针，未发现漏检。不把此状态写成 DOCX 功能可用，OOXML 内容验证仍在实施。

OOXML 首次实现提交 `48f3e5f8fdd0128e26ae960afa8fdd0f2fd34ff0`。主代理新运行完整单测165/165通过，专用 policy/ZIP/package 75/75及语法检查通过。但独立规格复核用新增探针发现两处缺口：xmldom静默接受非法XML/XMLNS保留绑定；关系Id缺少XML NCName完整验证。两者正在以RED回归测试修复，未据此宣布此阶段验收。第一版明确只支持XML1.0，避免xmlParts去除声明后改变XML1.1的命名空间语义。

后续复核修复：`8a91d05`执行保留绑定与Unicode NCName规则；`73e0040`通过公开解析选项使用XML1.0行结束规则，保留合法NEL/LS/PS及CDATA/属性文本；`4c91864`以XML S和QName边界拒绝根外非法文本/CDATA、不合法自闭合及U+0080分隔，同时保留U+1680/U+FEFF合法名称。每组实际失败探针先加入RED测试，再转GREEN；主代理最新专用测试88/88，独立规格复核另测37拒绝/11合法输入通过，质量复审另测34拒绝/17合法输入及完整178/178通过。语法/空白检查通过，无未解决审查问题。此阶段验证完整DOCX包结构，但转换和界面尚未实施；最终完整回归仍需随后续集成复核。

## 依赖发行核对

使用 npm 官方发行包，在独立临时目录下载并阅读许可、公开接口、浏览器入口及安全说明；此项不是转换正确性证明。锁定安装和构建会继续验证。

| 依赖 | 版本 | 许可 | npm 发行完整性 |
| --- | --- | --- | --- |
| Mammoth | 1.13.0 | BSD-2-Clause | `sha512-2cawcYFcP7ISfXbBcL9lmVgTNWo88v/52ND1gnywHtVT/pX0//puPnf0iMPV9ZgmuvNOE+zkIhDgZ9M2c2dDDg==` |
| DOMPurify | 3.4.17 | MPL-2.0 OR Apache-2.0 | `sha512-B/pSlYVHQ58kqISD/yDjuJ1yfzI34m1gF4lAod2bwSRhiN4K5Cl3H8Af7hqB2PmTL911tdEudnnXn5FnhRoz0w==` |
| @xmldom/xmldom | 0.9.12 | MIT | `sha512-5AXjrcMClTryPe9LgZrygpB1lj7s0S9E0+W+AHaVKAVyHanafK86iPSvG5xHVSp/jC+VH1UXu0TAEmY279xH7A==` |
| pako | 3.0.2 | MIT AND Zlib | `sha512-uBv6IT2aT1A78iU6dpNEbf6+CyhlV/6g9JlJs9kpgjFGFhruIICVRysF/W0SLzXg5+hCl+KroH7e4YUyfEmgLg==` |

Mammoth 明确不清理恶意输入，并提示高 CPU/内存风险；必须独立后台任务、有界包验证、HTML 清理和空权限隔离 iframe。浏览器文件读取实现拒绝外部图片。嵌入 style map 与外部访问均须显式禁用。DOMPurify 默认包含 SVG/MathML/CSS，不能使用默认配置代替项目的固定白名单；清理后只允许恢复项目生成且已验证的图片资源。

ZIP 实施者自查发现 fflate 0.8.3 忽略 stored block 的 NLEN 补码；保留原输出和 CRC 的损坏样例会被接受。与 Node 原生 zlib 对照的变异调查还发现其他 Huffman/距离结构的漏检。因此保持 fflate 打包功能，实际解压改用固定 pako 3.0.2 的公开流式接口；采用256字节输入/64KiB输出块和实际计数，不自行实现解码器。该调整不增加运行时网络或权限。损坏结构的负向回归与原有合法 ZIP/资源限额测试均必须通过后才完成此阶段。

## 未验收范围

一次开发中全套检查碰到 ZIP 测试正在刻意 RED 的四项失败，以及三项旧 PDF 构建测试的 esbuild 进程退出（`The service was stopped`）。未因此修改产品源码。相同旧构建测试在默认受限环境重复失败 0/3，在获准的本地执行环境重跑 3/3 通过；构建检查后续使用该环境。仍需最终完整检查，不把该开发中运行当成绿色回归证据。

真实 DOCX 内容转换、图片实际解码、沙箱/CSP、取消/超时、原字节下载、油猴与扩展界面均须继续实施验证。现有阅读器验证记录的管理器重启来源警告仍有效，不能被本轮单元测试覆盖。Windows Edge、实际 Firefox 安装包与真实课程兼容性必须另有实测证据，不能由注入测试推断。
