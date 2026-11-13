# Agent Note: 用 Muse 替换独立 Chat 的可见位置

Status: implemented

## Problem

用户要求鸿蒙增加 Muse 并替换原独立 Chat 的位置，图标以官网默认图标重绘。原 Chat 还包含已发布的配置、凭据与受限插件协议，不能通过改名或覆盖旧记录把它接到新的外部站点。

## Decision

- 默认新增独立 `muse` 站点，地址 `https://muse.ai/`。底栏与 Codey 详情的站点切换为 Codex、Keeper、Magpie、Muse，CPA 仍在更多；旧 `chat` 继续隐藏，Preferences、Cookie、凭据和对话不删除、不复制或迁移。
- Muse 使用现有通用 ServiceWeb 和独立凭据 ID，允许正常 HTTPS 地址设置。仍保留来源／路径绑定、主动外链确认、禁止混合内容及原生桥接限制；不安装 Chat 或 Magpie 页面适配，不自动登录、提交或接受外部授权。
- 图标依据官网公开 `https://muse.ai/images/favicon/app-squiggle.svg` 的手写 M 形态重新绘制为本地 24×24 SVG；常态深灰，选中采用官网蓝色范围。资源不包含远程图片、脚本或 display-p3 样式，不复用旧聊天气泡。

## Existing-note audit

[隐藏独立 Chat 与 Magpie 导航](../bug-fix/2026-11-12-harmony-magpie-navigation.md)部分重叠：仅三入口数量被四入口取代，隐藏旧 Chat、保留数据和 Magpie 导航决定不变。[DOM v2](../architecture/2026-11-13-harmony-codey-ui-dom-v2.md)独立约束 Codey 接管，不扩展为 Muse 的注入协议。既有 Chat 数据与凭据记录仍有发布存量，不删除其实现或测试。

## Alternatives considered

- 将 `chat` 改名并覆盖 URL 最省行数，但会混淆旧设置、凭据作用域和 Chat 插件桥接；新增独立 ID，仅替换可见位置。
- 为 Muse 扩大第三方登录来源或复用 Magpie DOM 注入可减少未知页面的操作，但未验证实际授权流程和页面合同；保留原网页导航及安全限制，不猜测控件。

## Verification

先新增四项反例，旧实现因缺少站点、凭据 ID、图标及原生资源绑定全部失败；实现后通过。完整 `node --test mobile/tests/*.test.cjs` 共 178 项通过，覆盖旧 Chat 保留、Muse 保存／HTTPS 校验、独立凭据 ID、可见导航和 SVG 自包含。

## Consequences

Muse 获得独立常驻 Web 入口，旧 Chat 数据仍可恢复但不在 UI 暴露。官网和默认 SVG 已只读核实，未使用真实账号登录，未检验 Meta 跨站授权或注册流程；HAP 编译、ArkWeb 渲染和真机行为仍需单独验收。本次不发布、安装或改变 121 服务。
