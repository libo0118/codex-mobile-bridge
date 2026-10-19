# 沿用现有移动端界面

本次是原生外壳移植及已有管理页面的页签容器，不重新设计聊天界面。聊天、工作区、账号等页面仍来自同一网关 `web/`，三个共用注入脚本保持原顺序。

原生电脑列表沿用 Android `MainActivity` 的视觉值：页面 `#f5f5f3`、白色卡片、主要文字 `#202124`、次要文字 `#777b80`、浅色操作面 `#f4f5f7`、移除操作 `#b44235`；页面边距 20 vp，卡片圆角 22 vp，按钮圆角 12–16 vp，主要操作高度 54 vp，次要触控不低于 44 vp。标题 30 fp、分区标题 19 fp、电脑名 17 fp、正文 14–16 fp、辅助文字 12–13 fp。文本允许系统缩放，连接入口、菜单和图标等价操作保留可读名称。

主任务依次是：核对并连接自己的电脑、继续现有聊天、查看文件结果、返回电脑列表。Keeper / CPA / Magpie 的工具栏复用相同颜色、按钮和文字规则；站点内容本身不改造。首次打开后使用独立且常驻的 Web 实例，切换仅改变可见性。站点设置改变 URL 和用户主动刷新才重新加载；应用重启后的重新加载是系统生命周期边界。

管理页工具栏保留历史返回、登录信息与带可访问名称的 44 vp 更多按钮；刷新和站点设置进入同一个菜单，站名单行省略，为 320–360 vp 窄屏留出操作空间。历史返回不调用刷新或替换 URL。此布局仍需鸿蒙设备的实际渲染验证。

安全区由默认非沉浸窗口保留。Codex 页面在通过来源与令牌验证后可同步顶部状态栏背景；底部系统手势栏与应用的浅色底面一致。管理站点无此桥接权限。密码与私密入口的操作在原生登录信息面板中完成，不增加网页中不可见的自动提交动作。

## 悬浮玻璃底栏与 D App图标

2026-10-19 用户指定悬浮玻璃胶囊及统一图标，随后要求收紧下方留白、按官方API支持系统材质和可调模糊。App继续使用D「刻线控制台」，名称 `Codex+`、bundleName保持不变；Harmony build 36。

App 主形采用D的银白双门架与琥珀连接梁，背景 `#252A2C`，原始 SVG、透明前景和1024px PNG保存在 `branding/`，主形全部位于中央75%安全圆。四个导航图标重新统一为24vp原创单色填充路径：聊天终端、保险库、分支路由、鸟翼。默认 `#303640`，选中 `#0A59F7`；选中图形同时由轮廓变为实心，保留文字与完整可访问名称。

胶囊宽度为屏幕90%、最大380vp，60vp最小按钮高度，外侧上12vp、下2vp。下方应用留白比build35减少10vp，系统手势安全区由操作系统保留。图标上、12fp标签下，系统字体可使原生布局增高。

长按任意页签的底栏，或打开Codex原生菜单中的“底栏外观”，进入共享设置面板。实时预览，点“完成”保存；直接关闭恢复已保存的外观。偏好仅写入 `bridge-computers` 的独立 `navigationAppearance` JSON key，字段是受限的模式、0–100模糊值和0–4厚度档，不更改连接、语言、通知或凭据。保存失败会提示。无网页刷新、URL替换或Web实例重建。

兼容路径使用 `backgroundBlurStyle(COMPONENT_REGULAR, { scale: blur/100 })`，`scale`自API12支持，范围0–1。API14的窗口焦点策略在失焦时使用 `#F2F5F8` 实色。系统沉浸材质路径只在OS API26及以上延迟导入 `SystemGlass26`，再查询 `uiMaterial.isImmersiveMaterialSupported()`；模块或能力不可用则回退。设备支持时使用公开的 `systemMaterial(new uiMaterial.ImmersiveMaterial({style}))`，提供超薄至超厚五档；系统材质没有连续半径参数。切换回兼容路径先清除系统材质，避免两种效果叠加。此组件不修改应用全局材质配置，不关闭系统性能自适应。

玻璃胶囊放在原有独立原生底栏区域中，网页高度自然避开它；系统字体放大时原生布局允许按钮增高。保留 selectTab、常驻Web实例和Visibility切换，不增加刷新或重建。这个区域下方是平坦底色；官方文档未保证材质跨ArkWeb渲染面取样，因此不宣称能折射或模糊网页文字，实际材质与软键盘避让需真机验证。

规范依据：[Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)、[OpenHarmony背景模糊](https://github.com/openharmony/docs/blob/OpenHarmony-v7.0-Release/zh-cn/application-dev/reference/apis-arkui/arkui-ts/ts-universal-attributes-background.md)、[公开系统材质API26](https://github.com/openharmony/docs/blob/OpenHarmony-v7.0-Release/zh-cn/application-dev/reference/apis-arkui/arkts-apis-uimaterial.md)。系统沉浸材质在较早版本属于系统接口，本应用不在API23/24调用它。实际效果遵循设备算力和系统沉浸光感设置。

图标与可交互预览保存在 OpenDesign 项目 `codex-mobile-icons-final-20261019`。未将含联系人、聊天或IP的完整截图提交到设计项目或仓库。原生编译与真机显示是不同验证边界。
