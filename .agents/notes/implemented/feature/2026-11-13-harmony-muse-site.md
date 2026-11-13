# Agent Note: 用 Muse 替换独立 Chat 的可见位置

Status: implemented

## Problem

用户要求鸿蒙增加 Muse 并替换原独立 Chat 的位置，图标以官网默认图标重绘。原 Chat 还包含已发布的配置、凭据与受限插件协议，不能通过改名或覆盖旧记录把它接到新的外部站点。

## Decision

- 默认新增独立 `muse` 站点，地址 `https://muse.ai/`。底栏与 Codey 详情的站点切换为 Codex、Keeper、Magpie、Muse，CPA 仍在更多；旧 `chat` 继续隐藏，Preferences、Cookie、凭据和对话不删除、不复制或迁移。
- Muse 使用现有通用 ServiceWeb 和独立凭据 ID，允许正常 HTTPS 地址设置。仍保留来源／路径绑定、主动外链确认、禁止混合内容及原生桥接限制；不安装 Chat 或 Magpie 页面适配，不自动登录、提交或接受外部授权。
- 图标依据官网公开 `https://muse.ai/images/favicon/app-squiggle.svg` 的手写 M 形态重新绘制为本地 24×24 SVG；常态深灰，选中采用官网蓝色范围。资源不包含远程图片、脚本或 display-p3 样式，不复用旧聊天气泡。
- `ServiceWeb` 对主框架网络错误显示数值错误码，对 HTTP 错误显示状态码，对未获用户动作的外站导航显示拦截提示；不显示响应正文、查询参数或片段。Muse 的更多菜单提供用户主动的“用系统浏览器打开 Muse”，仅转交配置中的公开 HTTPS 地址，不转交当前登录页地址或凭据；不自动打开、不伪装浏览器或扩大允许来源。
- 每次 HAP 更新同时递增显示版本和构建号，并同步构建清单、关于页及 UA 的版本标记，保持同一应用身份；本候选为 2.1.2/build 45。

## Existing-note audit

[隐藏独立 Chat 与 Magpie 导航](../bug-fix/2026-11-12-harmony-magpie-navigation.md)部分重叠：仅三入口数量被四入口取代，隐藏旧 Chat、保留数据和 Magpie 导航决定不变。[DOM v2](../architecture/2026-11-13-harmony-codey-ui-dom-v2.md)独立约束 Codey 接管，不扩展为 Muse 的注入协议。既有 Chat 数据与凭据记录仍有发布存量，不删除其实现或测试。

## Alternatives considered

- 将 `chat` 改名并覆盖 URL 最省行数，但会混淆旧设置、凭据作用域和 Chat 插件桥接；新增独立 ID，仅替换可见位置。
- 为 Muse 扩大第三方登录来源或复用 Magpie DOM 注入可减少未知页面的操作，但未验证实际授权流程和页面合同；保留原网页导航及安全限制，不猜测控件。
- 手机白屏的具体失败点尚未捕获，直接改 UA、默认域名或移除导航保护没有对应证据；只补可复现的失败反馈和显式外部打开入口，不把此候选当成白屏根因修复。

## Verification

先新增四项反例，旧实现因缺少站点、凭据 ID、图标及原生资源绑定全部失败；实现后通过。完整 `node --test mobile/tests/*.test.cjs` 共 178 项通过，覆盖旧 Chat 保留、Muse 保存／HTTPS 校验、独立凭据 ID、可见导航和 SVG 自包含。

失败反馈候选先新增三条反例，分别因自动外站导航没有提示、缺少 HTTP 错误回调、缺少主动浏览器入口而失败，补齐后 Muse 定向测试 8 项、`node --test mobile/tests/harmony-*.test.cjs` 152 项通过。另执行真实 `allowed/onLoadIntercept/onPageBegin/onPageEnd/onRefreshAccessedHistory/activeChanged` 方法，证明 `https://muse.ai/#weblink` 被允许且不触发 `loadUrl`、刷新或 DOM 注入；这条原有导航行为不需要修复。

公开默认页面只读请求返回 HTTP 200、标题为 `Muse — Your Personal AI Agent from Meta`。对初始 HTML 及其直接引用的 49 段公开脚本的有界静态检查没有定位到 `weblink` 字面量、可证实的首屏跨源自动跳转或针对 ArkWeb 的能力拒绝；此结果不代替手机执行证据。本机缺少 `HOS_SDK_HOME`，原生编译与候选产物核验交由固定提交的 Actions 构建，不复用旧 CI 包冒充新产物。

## Consequences

Muse 获得独立常驻 Web 入口，旧 Chat 数据仍可恢复但不在 UI 暴露。官网和默认 SVG 已只读核实，未使用真实账号登录，未检验 Meta 跨站授权或注册流程；本次失败反馈候选的 HAP 编译、ArkWeb 渲染和真机行为仍需单独验收。HTTP 200 下的脚本／绘制白屏不一定触发错误回调，不能承诺新提示覆盖全部白屏；下一步需要同设备实际错误码或经脱敏的 ArkWeb 错误片段。浏览器使用自身登录态，原生壳不复制 Cookie。本次不发布、安装或改变 121 服务。
