# Agent Note: 鸿蒙接管 Cindy/Codey 显式 DOM v2

Status: implemented

## Problem

Cindy 主导的新项目/会话列表与新建页不再承诺旧 Codey 标题、电脑状态 span 或侧栏 class。继续依赖旧文案/结构会拒绝新页面；放宽旧 collector 又会把未知控件误认成原生菜单能力。已经发布的无 schema 前端仍需可用，认证、原生导航与常驻 Web 边界不能随视觉迁移改变。

## Decision

- `CodeyUi.ets` 先在 `.remote-shell` 中查找显式 Workspace。只接受唯一 `data-codey-ui="2"` 根、合法 `data-codey-scene="list|create|conversation"`、唯一 header/footer，以及 footer 内各唯一的 `archive/console/logout` 原按钮。button 与 RNWeb `role="button"` 都可用，`disabled`/`aria-disabled` 保留真实禁用语义，归档必须有合法 `aria-pressed="true|false"`。
- `create/conversation` 还必须有唯一 Workspace `back`，list 不得有。外层 `[hidden]` 保留 Workspace 时，只允许通过 `.remote-shell` 中 Workspace 外唯一的 `data-codey-console-back` 返回；panel 禁用 archive/console，保留原 logout。`chat` 对 create/conversation 为 true，list/panel 为 false，仍使用原 `CodeyUiState` 布尔字段，不改 Index 事件时序或开放新原生能力。
- 显式版本未知、scene/控件缺失或重复、pressed 非法都拒绝接管，撤回已有标记；不会再猜旧 DOM。只有没有显式 schema 才调用已发布前端的原 collector，并保留旧紧凑 grid。
- 继续要求顶层窗口、完整 `location.href === expectedURL`、同源样式表与带导航 token 的原生 prompt 确认。确认后才隐藏 footer；v2 仅给显式 header 右侧预留 64 px，不改 Cindy 内部布局。四个动作只 click 当前原控件，动作和系统返回都先重新同步并要求已确认接管，结构/URL 变化时恢复网页自身导航。
- 观察器覆盖版本、scene、action、chrome、console-back、禁用和选中属性。v2 不读取正文/控件文案；消息字符、输入内容与不含合同节点的普通 childList 不触发全页收集。接管标记幂等写入，resize 的相同状态同步也不重复写标记。旧前端的消息区过滤保持原约定。

## Existing-note audit

按 CodeyUi、Codey、Cindy 检索活跃 proposed、implemented、rejected，命中六篇：

- [旧 Codey 紧凑操作区](../bug-fix/2026-11-04-harmony-codey-compact-controls.md)部分重叠：无版本识别不再用于新前端，旧 collector/grid、原动作与原生授权理由保留，双方互链。
- [三入口与 Magpie 内部导航](../bug-fix/2026-11-12-harmony-magpie-navigation.md)、[电脑保留](../feature/2026-11-06-harmony-retained-computers.md)、[历史 Chat 站点](../feature/2026-11-06-harmony-chat-site.md)、[统一紧凑导航](../feature/2026-11-06-harmony-flat-navigation.md)、[原生相机](../bug-fix/2026-11-06-harmony-native-camera.md)与本次 DOM 版本选择无关，各自的入口、生命周期、数据或权限边界不变。不删除、归档或改写这些决定。

## Alternatives considered

- 继续放宽旧标题/class/文案识别改动较少，也能覆盖相似页面，但 Cindy/RNWeb 内部布局没有这个约定，且无法区分未知 schema。显式版本只约束新用法，不扩散旧 DOM 别名。
- 只支持 v2 能减少 collector 数量，但会破坏已经发布且无 schema 的前端；保留真实存量 collector，显式声明失败时则不回落。
- 在 HAP 新增后端动作接口可摆脱 DOM，但会复制控制器/认证及错误处理，并扩大权限表面；继续点击前端原控件，不新增 API。

## Testing

`node --test mobile/tests/harmony-codey-ui.test.cjs` 执行生产 ArkTS 函数、生成的脚本与原 Index 方法。新增 fixture 仅使用合同 class `.remote-shell`、显式数据属性和 button/role，不含旧 Codey 标题、host、列表/输入区 class 或中文控件标签；覆盖 list/create/conversation、只读控制台、四动作、禁用、重复/缺失控件、未知版本、非法 scene/pressed、拒绝确认、URL/主框架变化、复用根动态 scene、结构修复、原生底栏/切回与消息流零接管写入。原有无 schema 用例保留。

本次只做离线 Node 验证；实际前端 production bundle 联合验证由主任务汇合后执行，不把合成 VM 当成 ArkWeb。实时检查 PATH 中只有 node，没有 ohpm/hvigorw，`HOS_SDK_HOME`/`DEVECO_SDK_HOME` 未设置；不安装工具链，不编译、安装、升版本或发布 HAP。

## Consequences

新前端可以自由使用 Cindy/RNWeb 结构与文案，代价是必须保持小而明确的 DOM 合同；未知版本保留网页自身导航而不提供原生替代操作。旧 collector 只为已发布前端保留，未来移除需独立确认存量退出条件。独立 Chat 隐藏规则、Codex/Keeper/Magpie 与 CPA 更多、权限/来源/路径/主框架/token/动作 allowlist、常驻 Web 和返回语义都不放宽。

未捕获本次 ArkUI/ArkWeb 实机画面，64 px 让位、软键盘、安全区和 RNWeb 在目标设备的实际呈现仍需对应 HAP 构建与真机验证；没有连接生产、操作真实账户、发送模型消息或改动另一 Codey 仓库。
