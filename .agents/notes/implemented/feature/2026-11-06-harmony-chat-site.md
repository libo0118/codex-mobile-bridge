# Agent Note: 鸿蒙 Chat 独立站点入口与外层承载

Status: implemented

## Problem

鸿蒙需要独立的 Chat 底部入口，并允许用户启停和调整地址，而不影响已保存的 Keeper、CPA、Magpie 配置。默认地址的 `view=plugin-chat` 是必要的页面选择，不能把任意查询参数或私密入口写入普通站点设置。部署页面在插件异步注册前会把首次深链接切回其他页面；Chat 又由站点的沙箱 iframe 承载，外层页面样式不能穿过它。

## Decision

- `ServiceSite` 第五参数是默认启用的 `enabled`，第四参数 `loginOrigin` 不变。`ServiceStore` 追加 Chat 默认值；只有 Chat 可停用并保存空地址，损坏的 Chat 配置不静默恢复到已启用的默认地址。旧站点没有该字段时仍启用，Keeper 仍不可修改。
- Chat 地址仅接受普通 HTTPS 站点地址或唯一的 `?view=plugin-chat` 查询；凭据仍由用户明确操作并绑定独立的 `chat` ID 和去掉固定查询后的 HTTPS 站点路径。密码、私密入口链接与任意参数不写入普通站点配置，也不复用 `magpie` 的凭据记录。
- 仅当 Chat 实例的配置明确要求 `view=plugin-chat` 时，主框架识别 `#view-plugin-chat > iframe.plugin-frame` 并调整外层留白和最小高度，不修改 iframe 的 `sandbox`、URL、权限或内部页面。用户点击其他页面后不持续强制切回。
- 对确认部署页面的首次插件注册竞态，初始化期间仅在同一路径的当前视图及其插件导航按钮均可识别时点击一次；脚本安装前若标准 `navigator.userActivation.hasBeenActive` 已记录用户动作，或安装后发生真实用户操作、离开目标页面或 15 秒超时，均取消等待。该点击只选择原页面，不发送消息或调用聊天接口。

## Existing-note audit

[鸿蒙 Codey 紧凑操作区](../bug-fix/2026-11-04-harmony-codey-compact-controls.md)部分重叠在原生导航和页面状态边界，Codey 与本记录的第三方 Chat 仍是独立 Web；鸿蒙网页拍照记录涉及 Codex 的文件选择，与本决定无关。本决定不替代其他活跃记录。

## Alternatives considered

- 把任意查询参数直接存到站点设置最灵活，但私密启动链接可能含凭据；只允许已知的非秘密视图参数，其他私密入口继续使用原 HUKS 流程。
- 在父网页直接操作子页面能集中实现布局，但部署 iframe 只有 `allow-scripts`，其不透明来源阻止父页面 DOM 访问。移除 sandbox 或使用对全部 iframe 生效的宽泛脚本会破坏边界，因此不采用。
- 让用户每次手动重新选择插件无需处理注册竞态，但会违背选择 Chat 的初始意图；仅在首次请求且用户未操作时转交原导航按钮。

## Testing

`node --test mobile/tests/harmony-chat-site.test.cjs mobile/tests/harmony-credentials.test.cjs mobile/tests/harmony-keeper-ui.test.cjs` 执行生产 ArkTS 模型和注入脚本，覆盖默认与旧配置、空地址停用、重启恢复、非法参数、凭据范围、插件延迟注册、用户操作取消、外站和非主框架拒绝。

隔离 Mock 在浏览器中执行生产注入脚本：390×760 的外层 iframe 宽 390、高 654；320×500 模拟缩高时 iframe 宽 320、高 394，文档无横向溢出，sandbox 保持 `allow-scripts`。Mock 只验证外层缩放，不连接 Chat 服务，不能证明内部聊天和软键盘真实行为。

在独立浏览器标签对真实部署页面执行同一外层脚本，首次回退到供应商页后可识别并进入对话；390×760 与 320×500 的外框尺寸及 sandbox 与上述 Mock 一致。没有发送消息或更改子框架；浏览器设备尺寸模拟不等同于鸿蒙 ArkWeb 或系统软键盘验证。

## Consequences

真实部署的 Chat 子页面在小于等于 560px 时隐藏历史列表，当前展开按钮也不可见；输入区的发送、附件及模型控件约 24px。由于子页面通过沙箱 URL 导航，外层适配没有修复这些内部问题。OpenHarmony 的 [ScriptItem 与文档开始注入声明](https://github.com/openharmony/interface_sdk-js/blob/master/api/%40internal/component/ets/web.d.ts)没有明确保证不透明来源子框架的匹配行为，不据此声称已解决。需要 Chat 插件源码和受控部署范围，直接在插件内修复移动布局，并另行验证历史、发送、流式、附件和手机软键盘。

[HTML 标准](https://html.spec.whatwg.org/multipage/interaction.html#dom-useractivation-hasbeenactive)定义的 sticky activation 能记录脚本安装前的用户交互；当前未在目标 ArkWeb 实机验证该属性的实现和时序。如果运行时不提供此属性，安装前极快切页仍无法与站点自动回退区分；安装后交互继续由事件取消等待。

Node/Mock 不代表 ArkTS 编译、真实鸿蒙设备或实际 Chat 端到端验证；当前不自动发送聊天消息、不安装或发布 HAP。
