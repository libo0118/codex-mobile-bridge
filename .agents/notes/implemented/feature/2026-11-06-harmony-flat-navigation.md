# Agent Note: 鸿蒙统一紧凑导航

Status: implemented

## Problem

悬浮胶囊底栏和 Chat 的单独尺寸继续占用竖向空间。Chat 列表头与 Magpie 品牌头重复 Native 顶栏；用户要求统一微信式底栏，并将 CPA 从常用入口移到更多菜单。

## Decision

底栏在所有页面共用全宽 56vp 内容高度、24vp 图标、12fp 标签和 2vp 间隔，不再使用胶囊外框、阴影或悬浮边距。保留系统安全区和既有材质偏好；Codey、Chat 聊天时隐藏底栏的状态规则不变。四个常用入口是 Codex、Keeper、Magpie、Chat，CPA 保留在 Codex 更多菜单，以既有 `selectTab` 懒创建并复用页面。

Chat 列表头需插件明确确认可由 Native 接管，新建和设置才出现在顶栏；未确认仍保留子页原控件。[Chat 协议](2026-11-06-harmony-chat-site.md)记录已发布版本的可选字段兼容。聊天返回仍在 Native 顶栏左侧。

Magpie 仅在配置的 HTTPS 同路径、主框架且识别 `body.web>header.top`、`#nav` 和原 `#sync/#prefs` 后隐藏窄屏品牌头；视图导航保留。Native 顶栏常驻刷新、设置，操作点击原控件；网页返回与登录信息移到更多。登录页和未知结构不隐藏原界面，不扩大凭据范围或 iframe 权限。

## Existing-note audit

活跃笔记按底栏、NavigationMaterial、CPA、Chat 检索：上述 Chat 记录负责跨 sandbox 协议，[电脑保留](2026-11-06-harmony-retained-computers.md)负责控制器生命周期，[Codey 紧凑操作区](../bug-fix/2026-11-04-harmony-codey-compact-controls.md)负责已识别聊天的底栏显隐。三者部分重叠但均保留，未发现其他 proposed/rejected 同题决定。

## Alternatives considered

- 继续缩小胶囊改动最少，但仍留下两侧和上下留白，并使各页面高度不一致；采用同一个扁平行。
- CPA 切换时销毁旧 Web 可省内存，但会丢失原页面状态；只减少可见导航入口，不改变已加载服务生命周期。
- 父页面强行修改 Chat iframe 可省协议字段，但原 opaque sandbox 不允许 DOM 访问；不放宽权限，沿用已确认的 UI 意图桥接。

## Testing

`harmony-compact-chrome.test.cjs` 执行生产 Magpie 脚本与 Index 切换方法，检查原按钮点击、登录／外站拒绝、统一尺寸、CPA 入口及控制器保留；Chat 测试覆盖可选接管字段、新建、旧插件回执及 Native 状态。插件浏览器夹具覆盖新旧 bind、列表头显隐、新建不发消息、返回和流式草稿保留。

## Consequences

常用导航减少竖向占用，CPA 需多一次菜单点击。系统导航手势区仍额外保留，不承诺所有设备的物理像素高度相同；长字体可访问性、ArkUI 实屏和软键盘需另行真机验收。普通浏览器与旧 APP 仍保留网页自己的列表头。
