# Agent Note: Muse 网页导航与原生权限分离

Status: implemented

## Problem

真机 Muse 显示“已拦截非本站跳转”，确认现有主框架来源限制阻止了至少一次导航，但未取得目标完整地址。用户明确选择仅 Muse 按普通浏览器允许 HTTP/HTTPS 跨站跳转，其他入口、凭据作用域及本地能力保护保持不变。

## Decision

- 只在 `ServiceWeb.navigate` 对 `muse` 放行通过现有 `externalHTTP` 基础校验的网页地址，包括非手势跳转；不把导航许可写进复用的 `allowed` 或凭据校验函数。
- `file`、`intent`、`javascript`、`data` 等非网页链接不自动执行，其他服务仍按已配置来源及用户手势处理；Muse 不增加原生桥接或 DOM 注入。
- 跨站后仍禁止对不匹配的来源自动填入保存的凭据，不复制 Cookie 到系统浏览器。HTTPS 站点配置、混合内容和文件访问开关不变。
- HAP 每次更新递增显示版本与构建号；本次候选为 2.1.3/build 46，仅构建、不自动安装到手机。

## Existing-note audit

[Muse 入口](../../implemented/feature/2026-11-13-harmony-muse-site.md)的站点、图标、旧 Chat 数据保留及失败反馈仍成立，仅 Muse 的严格网页导航来源规则被本决定替代，双方互链。[Magpie 导航](../../implemented/bug-fix/2026-11-12-harmony-magpie-navigation.md)与本次独立，不放宽其注入或导航来源。

## Alternatives considered

- 继续只允许配置来源可以阻断自动外链，但用户已明确选择 Muse 正常跨站网页行为，现有真机提示也影响使用。
- 将所有入口、所有协议一起放开最省判断，但会扩大 Codey、Keeper、Magpie 及本地应用能力的信任范围；仅分离 Muse 网页导航与原生权限。
- 根据未知跳转目标添加域名白名单更窄，但没有实际地址且违背用户确认的 Muse 任意网页跳转策略；不猜测域名。

## Testing

- 两条新增生产导航回调反例先因 Muse 跨站被拦截而失败；变更后 Muse 定向 10 项、完整 Harmony 154 项通过。回归覆盖非手势的 HTTPS/HTTP 跨站、其他服务仍拒绝、片段不重新加载、非网页协议拒绝，以及调用真实凭据填写方法时不向跨站页面填入或注入。
- 版本、构建号、关于和 UA 一致性沿用构建脚本检查，打包元数据由固定提交的 Actions 核验；尚无真机新策略运行证据。

## Consequences

Muse 可以跳到任意合规网页，包括不可信站点或 HTTP 页面；用户应核对登录页面。此变更落实用户选择的导航策略，不证明所有 Muse 白屏原因均已解决，也不替代真机验收。
