# Agent Note: 鸿蒙隐藏独立 Chat 并保留 Magpie 内部导航

Status: implemented

## Problem

用户最新纠正是不显示独立 Chat，而不是恢复 Chat。新版 Magpie 的 `#prefs` 位于 `side-nav` 侧栏，不再在 `header.top` 内；旧适配因找不到设置而拒绝接管，且整块隐藏顶栏会丢失网页返回和更新提示。

## Decision

- 原生底栏和聊天中的站点切换菜单只显示 Keeper、Magpie（加固定 Codex）；CPA 继续在更多。移除独立 Chat 的可见设置入口和配置面板，不改 `ServiceStore`、Cookie、凭据或对话存储，不做迁移或清理。历史数据模型和受限插件协议仍保留，但不作为 Magpie 的适配器运行。`CodeyUiState.chat` 和只改变 `Visibility` 的常驻 Web 约定不变。
- Magpie 保留主框架、完整 URL 和配置来源/路径检查，识别原顶栏 `button#sync`、旧顶栏 `button#prefs` 或新版 `body.web.side-nav #prefs`。仅在两个原控件及 `#nav` 完整识别后隐藏这些重复控件；原生动作重新查找原节点并调用原 `click()`，不新增服务 API，不搬移或克隆节点。
- 原顶栏、`#nav`、`#sideToggle`、`#navBack`、更新提示、`#sideGw` 和内部会话/动态 plugin-chat 均不隐藏。没有可信的纯品牌/状态装饰 selector 时不猜测其父容器。缺少任一接管控件时撤回本适配样式，恢复原 UI。

## Existing-note audit

按 Magpie、Chat 入口/页签/设置检索活跃 proposed、implemented、rejected 目录，命中以下四篇，均部分重叠而非完全吸收：

- [独立 Chat 站点](../feature/2026-11-06-harmony-chat-site.md)：仅独立入口与设置入口的决定被取代，历史数据校验、凭据与 sandbox 协议仍有价值。
- [统一紧凑导航](../feature/2026-11-06-harmony-flat-navigation.md)：四入口与整块 Magpie 顶栏隐藏被取代，尺寸、CPA 和原按钮接管原则保留。
- [电脑保留](../feature/2026-11-06-harmony-retained-computers.md)：Chat 设置可达性被取代，多电脑生命周期和旧保存竞态边界保留。
- [Codey 紧凑操作区](2026-11-04-harmony-codey-compact-controls.md)：入口数量改变，Codey 聊天状态与 DOM/原生授权边界不变。

## Alternatives considered

- 直接删除 Chat 的存储模型能减少残留代码，但会混入数据格式与历史凭据变更；只收起可见入口，保留存量记录。
- 新版继续隐藏整块顶栏或侧栏最省样式代码，但会一并切断更新、返回、页面和网关切换；只隐藏有原生等价操作的两个控件。

## Testing

先新增 `side-nav` 设置位于顶栏外的回归，旧脚本返回 `outside`，6 项中 1 项失败；修复后同项通过。Node VM 继续执行生产 Magpie 脚本，检查旧/新布局、无自动点击、只转交刷新/设置、未知结构、来源/路径/主框架/过期 URL 拒绝及禁用控件。生产原生过滤谓词验证底栏和详情更多都不显示 Chat；存储回归验证加载历史 Chat 不写回或删除记录。

完整识别后设置入口消失的另一项反例先以旧样式仍残留而失败，修复后撤回样式，并允许结构恢复时重新接管。定向命令：

```sh
node --test mobile/tests/harmony-codey-ui.test.cjs mobile/tests/harmony-compact-chrome.test.cjs mobile/tests/harmony-appearance.test.cjs mobile/tests/harmony-chat-site.test.cjs mobile/tests/harmony-multihost.test.cjs mobile/tests/harmony-security.test.cjs mobile/tests/harmony-upload.test.cjs mobile/tests/harmony-download.test.cjs mobile/tests/harmony-credentials.test.cjs mobile/tests/harmony-display-style.test.cjs
```

浏览器工具无可用浏览器，未捕获合成页面渲染；不将 Node 模拟测试当作 ArkUI、ArkWeb 或真实站点视觉验证。

## Consequences

常用底栏为三入口；历史独立 Chat 设置暂不可从 UI 访问，数据仍留在原位置。Magpie 内部功能仍由原网页导航负责，未知装饰可能继续显示，避免错误隐藏功能。未自动点击真实站点、发送模型消息或读取会话/账户/密钥；无凭据只读请求站点得到 HTTP 401 后不继续认证。未安装工具链、编译/安装 HAP、部署或发布，仍需对应提交的构建和真机验收。
