# Agent Note: 鸿蒙 Codey 紧凑操作区

Status: implemented

## Problem

鸿蒙 Codex 页签可以加载 Codey 远程页面，但原适配只认识 Python 网关。Codey 的电脑状态、侧栏工具和原生四入口重复占用窄屏；原生更多按钮还会覆盖网页的新建入口。聊天已有单排主工具，不需要再造输入栏。页面在其他页签或应用后台变化时，状态回调会被原生拒绝；若返回后没有新 DOM 变化，旧聊天状态可能继续隐藏四入口。

## Decision

- 只在鸿蒙主框架的 Codey React 根中识别公开 DOM，使用同源样式表将原电脑状态排到标题旁；React 控件保留原位置，不搬移节点。没有 `#root` 的页面不增加观察器；根中尚未出现可识别控件时仅观察后续渲染，不隐藏原 UI。
- 复用现有原生更多菜单。新增静态 `archive`、`console`、`logout`、`back` 动作，分别点击原筛选、控制台、设备退出和列表返回控件，不增加 API 或写操作重放。
- 页面通过带导航 token 的 `codey-ui` prompt 仅报告 `supported/chat/archived/canArchive/canConsole/canLogout/canBack` 布尔状态；原生确认后才隐藏已完整识别的侧栏工具。动作再次核验主框架、菜单打开时的完整 URL、导航代次与当前 DOM。结构不明或桥接未确认时保留原 UI。
- 切回 Codex 或恢复应用前台时先清除原生旧状态，再用当前完整 URL 和 token 重复注入 `codeyUiScript`；已有页面适配器通过独立 `refresh` 重绑来源并强制报告，即使状态签名未变也需原生确认。普通观察器及动画帧仍只报告变化；后台拒绝规则不放宽，注入失败保留安全默认状态，迟到错误不能覆盖新 URL、token 或导航代次。
- 进入已识别聊天时仅隐藏原生四入口保留区域，不条件创建或销毁 Web；更多菜单仍可切到 Keeper、CPA、Magpie，回列表恢复四入口。原输入框、模型弹层、草稿和滚动不重构。
- 仅新增 Codex 裸局域网主机采用 `http://host:18787`；显式 URL、显式端口、已保存 Preferences 和公网 HTTPS 语义保持不变，裸公网域名仍使用 HTTPS 默认端口。Python 网关监听、其他站点和 Android/iOS 不变。

## Existing-note audit

在活跃 `.agents/notes/` 按 Harmony、鸿蒙、ProviderSwitcher、Keeper、原生菜单检索，无重叠记录。原生生命周期与来源边界继续以 `mobile/harmony/README.md`、`ARCHITECTURE.md` 为准。

## Alternatives considered

- 修改 Codey 共享 React 布局可直接解决所有客户端，但本需求只针对鸿蒙外壳，不能连带改变浏览器及 Android/iOS。
- 搬移原 React 节点或克隆新的网页登录/归档处理器能少写布局规则，但会破坏 reconciliation 或绕开原认证与错误处理；采用 CSS 排布和原控件点击。
- 一直显示四入口最容易保留导航，但聊天会继续叠两层底部操作；只在可回列表、可从更多切站点的已识别聊天隐藏它。
- 切回时刷新 Web 能重新探测状态，但会丢失页面内草稿和滚动；仅调用普通 `sync` 又会被相同签名缓存跳过。独立强制同步入口保留页面实例，并且不会把动画帧的时间戳误作强制参数。

## Testing

`node --test mobile/tests/harmony-codey-ui.test.cjs` 执行生产 ArkTS 函数、Index 生命周期与 prompt 方法和生成的页面脚本，覆盖主框架/URL/旧动作拒绝、原生状态确认、完整识别及未知结构回退、原动作点击、归档选中状态、聊天/列表往返、裸主机默认端口和存量 URL 保留。回归包含聊天切去 Keeper/CPA/Magpie 后后台变列表、退出或结构失配、首次 pageFinished 在后台被拒绝、相同签名下原生重置、应用前台恢复及过期异步回调；无需新增 DOM 变化即可恢复 footer/dock，控制器、草稿节点和滚动值保持不变。

隔离 Mock 使用生产注入脚本与 Codey 原样样式，以 390×844、320×740 验证标题同排、新建按钮与更多不重叠、原工具栏隐藏、聊天仅一排主操作及模型弹层。Mock 往返列表后草稿和 129.7px 滚动位置保留；四入口恢复。Mock 不连接真实 Codey，不读取聊天数据；其 HTML 模拟原生菜单和底栏，不代表 ArkUI 或手机实测。

## Consequences

只增加鸿蒙专用源码，不新增共享资源、网页登录处理器或后端接口。副作用仍由原网页负责，打开菜单和探测状态不触发点击。恢复时在原生收到新确认前暂时显示四入口；探测不可用或失败时不再沿用旧聊天状态。

DOM 是部署页面的公共呈现而非正式版本化接口；未知结构退回原界面。320px 下电脑名称可以省略，配对状态及可访问名称保留完整。ArkUI 菜单、软键盘和 Web 保留区的原生呈现仍需要该提交的 CI 编译及真实设备验收；本次不在本机安装 SDK、编译或安装 HAP，不升版本或发布 App。Node VM 证明状态与调用边界，不代表 ArkUI 真实渲染已核验。
