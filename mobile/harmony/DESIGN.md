# 沿用现有移动端界面

本次是原生外壳移植及已有管理页面的页签容器。聊天、工作区、账号等页面仍来自同一网关 `web/`，鸿蒙端叠加显示适配；三个共用注入脚本保持原顺序。

原生电脑列表与已确认的 Cindy/Codey 移动样式协调：页面 `#f8f8f5`、卡片 `#fffffc`、1 vp `#dfe2dc` 描边，主要文字 `#202124`、次要文字 `#777b80`、浅色操作面 `#f4f5f7`、移除操作 `#b44235`；页面边距 20 vp，卡片圆角 18 vp，扫码主操作为 54 vp 胶囊，内层按钮圆角 12 vp，次要触控不低于 44 vp。标题 30 fp、分区标题 19 fp、电脑名 17 fp、正文 14–16 fp、辅助文字 12–13 fp，主页面标题使用 Medium。文本允许系统缩放，连接入口、菜单和图标等价操作保留可读名称。只调整外观，不改连接、凭据或下载格式。

主任务依次是：核对并连接自己的电脑、继续现有聊天、查看文件结果、返回电脑列表。CPA / Magpie 的工具栏复用相同颜色、按钮和文字规则；Keeper 另做鸿蒙客户端显示适配。首次打开后使用独立且常驻的 Web 实例，切换仅改变可见性。站点设置改变 URL 和用户主动刷新才重新加载；应用重启后的重新加载是系统生命周期边界。

网关应用切换在 Harmony 中收进聊天列表顶部：保留当前应用品牌图标，名称改为有“切换聊天应用”可访问标签的44px原生HTML选择器，为右侧原生更多菜单保留48px。独立 `ProviderSwitcher` postlude 在三个共享脚本之后、相同主框架和精确URL校验之内执行。它读取上游稳定的 `#client-switch` 当前按钮并调用原按钮的click，不绕过 `ClientNavigation.choose` 或另存应用状态。只在可用选择器已建立时隐藏 `.client-switch-dock` 和 `.client-functions`：账号管理、第三方通知、应用管理及返回电脑列表转入右上原生菜单，网页原按钮和onclick仍保留供菜单调用。标题随网关移动到DSH/Claude列表时选择器一同移动。轮询重建按钮、启停应用及快捷图标偏好通过单一观察器同步；没有可用源按钮或旧网关契约不符时保留原导航。此适配不修改网关源码或共用注入脚本，不增加刷新、原生桥接权限或新的DSH进程。

Codey 远程页面由独立 `CodeyUi` postlude 接管。Cindy 主导的前端在 `.remote-shell` 中用唯一 `data-codey-ui="2"` Workspace 声明 `list/create/conversation`，通过唯一 header/footer 和 `archive/console/logout/back` action 标记暴露原控件；按钮可以是 HTML button 或 RNWeb `role="button"`，不读取其文案、标题或自动样式类。完整校验及原生确认后隐藏 footer，header 右侧预留 64 px。未知显式版本或结构失配不得回落旧 collector。没有显式 schema 的已发布前端仍识别原 React 根、标题和电脑状态，保留紧凑 CSS grid；不移动或克隆节点。归档仍只是列表筛选，菜单状态来自原 checkbox/aria-pressed，控制台与设备退出也只点击原按钮。“已配对”不改为执行进程在线。详见[DOM v2 决定](../../.agents/notes/implemented/architecture/2026-11-13-harmony-codey-ui-dom-v2.md)。

Codey 聊天沿用网页输入组件，不另造原生输入栏。v2 新建与会话页都通过 `CodeyUiState.chat` 将原生底栏设为 `Visibility.None`，列表和只读控制台为 false；旧前端沿用 `has-selection`。Web 和站点组件保持原挂载位置，回列表恢复底栏。控制台保留被外层 `[hidden]` 隐藏的 Workspace，只通过外层唯一 `data-codey-console-back` 返回；归档和控制台动作不可用，退出仍调用原控件。主框架通过 `codey-ui:<导航 token>` 仅报告现有布尔状态；动作使用静态 allowlist，重新核验菜单打开时完整 URL、导航代次、来源和当前原控件，不运行页面提供的脚本。观察器覆盖 schema、scene、action、chrome、禁用和选中属性；v2 不随输入或消息正文字符扫描、重复写接管标记。新增裸局域网主机默认 `http:18787`，完整 URL、显式端口、存量连接和公网 HTTPS 默认语义不变。[旧前端与原生边界](../../.agents/notes/implemented/bug-fix/2026-11-04-harmony-codey-compact-controls.md)。

Keeper、CPA、Magpie、Muse 共用 56 vp 原生标题栏：左侧为单行 17 fp 站名，Keeper、CPA、Muse 右侧为网页返回、登录信息、更多三枚 24 vp SVG 图标，Magpie 常驻刷新、设置与更多，网页返回和登录信息在更多中；每枚按钮有 44 × 44 vp 点击区、包含站名的中文可访问名称和原生按压及焦点反馈。返回沿用浏览历史，登录信息显式打开该站点唯一的安全凭据面板，失活时禁用。Magpie 同时识别旧顶栏 `#prefs` 和新版 `body.web.side-nav #prefs`，只隐藏被原生接管的 `#sync/#prefs`，保留原顶栏、`#nav/#sideToggle/#navBack`、更新提示和有功能的 `#sideGw`。未知控件不猜测、不隐藏；不搬移或克隆网页节点、不新增服务 API。站名单行省略，为 320–360 vp 窄屏留出操作空间。历史返回不调用刷新或替换 URL。此布局仍需鸿蒙设备的实际渲染验证。

build40 使用用户明确选定的 C「同心圆环」原稿：三枚图标的圆心均为 (12,12)，外圈半径 9.25、线宽 1.6，颜色 `#303640`；圆框内分别为返回折线、实心钥匙孔和横向三点。按钮常态透明，44 vp 热区使用 22 vp 圆角，保留按压反馈并避免叠加常驻外框。三个管理页直接共用同一组资源；已选 App 图标与底部玻璃导航不变。

Keeper 不再叠加浮动更多按钮。网页顶部保留 48 px 当前分区/所选平台摘要，不再为浮动按钮预留右侧空间。原网页 KEEPER 标题和全部导航工具区在可用替代入口建立后收起。更多菜单第一层按页面切换、平台筛选、认证文件、站点工具分组；第二层在 Web 内呈现当前真实控件的选择状态、禁用及加载状态。页面切换与平台选择从当前原节点重新查找并调用 click；仅启用只读明确匹配的 checkbox 状态并由用户点击触发原 onChange。巡检与限额更新无自动触发。语言、主题、CPA、更多操作及页面筛选使用原控件在原 DOM 位置的折叠展开，不移动、克隆 React 节点，也不读取凭据列表内容或登录值。

`KeeperUi` 的主框架、精确注入 URL 与固定 HTTPS `/keeper` 路径校验同时生效；每次原生动作和网页代理点击再次检查。即使同源的 `/cpa/`、`/magpie/` 也不适配。单一观察器同步 SPA 重绘，幂等注入不重复安装；无法完整识别某组时保留该组原布局，用户可在原生菜单切换全部原网页工具栏。二级面板支持关闭、Esc、焦点回返及系统返回；原生返回请求一秒内未完成时仅在仍处于同一 Keeper 导航的情况下返回 Codex，迟到结果不能切走其他页签。登录信息仅增加显式打开请求与隐藏触发按钮，沿用既有 HUKS、作用域校验和临时明文清理。列表使用站点明暗主题变量、18 px 分区标题、16 px 正文基础、13 px 辅助说明及至少 44 px 行内按钮；不改服务器、额度数据、凭据行和编辑表单。公开结构/示例数据的浏览器预览不能替代登录态和鸿蒙真机验证。

安全区由默认非沉浸窗口保留。Codex 页面在通过来源与令牌验证后可同步顶部状态栏背景；底部系统手势栏与独立底栏区域同为白色。管理站点无此桥接权限。密码与私密入口的操作在原生登录信息面板中完成，不增加网页中不可见的自动提交动作。

## 全宽原生底栏与 D App图标

App 继续使用 D「刻线控制台」，名称 `Codex+`、bundleName 与已有图标资源保持不变。当前采用全宽四入口布局，不恢复旧版悬浮胶囊，也不在 Codey 网页增加重复导航。

App 主形采用D的银白双门架与琥珀连接梁，背景 `#252A2C`，原始 SVG、透明前景和1024px PNG保存在 `branding/`，主形全部位于中央75%安全圆。导航沿用24vp原创单色填充图标资源。默认 `#303640`，选中 `#0A59F7`；原有图形选中时由轮廓变实心；Muse 采用官网默认手写 M 的本地重绘线稿，选中为官网蓝色范围，保留文字与完整可访问名称。

底栏宽度为屏幕 100%、高度 56 vp，各入口等分可用宽度。保留 Codex、Keeper、Magpie、Muse，CPA 仅从 Codex 更多菜单进入。独立 Chat 及其原生配置入口不再显示；历史 Preferences、Cookie、登录信息和对话数据不删除、不迁移。Magpie 内部会话与 plugin-chat 导航照常保留，不安装独立 Chat 的强制选页/隐藏导航适配。`CodeyUiState.chat` 用于新建与聊天详情隐藏底栏。[决定与验证](../../.agents/notes/implemented/bug-fix/2026-11-12-harmony-magpie-navigation.md)。图标在上、12 fp 标签在下，点击宽度不低于 44 vp，系统手势安全区由操作系统保留。

Muse 以独立 `muse` ID 接入通用 ServiceWeb，默认 `https://muse.ai/`，不覆盖或迁移隐藏的旧 Chat；登录与跨站授权由用户操作，HTTPS、外链确认和凭据来源绑定不放宽。[Muse 入口与图标决定](../../.agents/notes/implemented/feature/2026-11-13-harmony-muse-site.md)。

底栏和设置预览复用 `NavigationMaterial`。原生 Row 的基底为 `#f8f8f5`，不再使用悬浮胶囊轮廓或独立装饰阴影；系统手势背景继续使用系统窗口约定。用户保存的模糊、系统材质模式与厚度设置不重置。

长按任意页签的底栏，或打开Codex原生菜单中的“底栏外观”，进入共享设置面板。实时预览，点“完成”保存；直接关闭恢复已保存的外观。偏好仅写入 `bridge-computers` 的独立 `navigationAppearance` JSON key，字段是受限的模式、0–100模糊值和0–4厚度档，不更改连接、语言、通知或凭据。保存失败会提示。无网页刷新、URL替换或Web实例重建。

兼容路径使用 `backgroundBlurStyle(COMPONENT_ULTRA_THIN, { scale: blur/100 })`，`scale` 自 API12 支持，范围 0–1。API14 的窗口焦点策略在失焦时使用半透明 `#99F8F8F5`。系统沉浸材质路径只在 OS API26 及以上延迟导入 `SystemGlass26`，再查询 `uiMaterial.isImmersiveMaterialSupported()`；模块或能力不可用则回退。设备支持时使用公开的 `systemMaterial(new uiMaterial.ImmersiveMaterial({style, applyShadow: false}))`，提供超薄至超厚五档；系统材质没有连续半径参数。切换回兼容路径先清除系统材质，避免两种效果叠加。此组件不修改应用全局材质配置，不关闭系统性能自适应。

底栏放在独立原生区域中，网页高度自然避开它。保留 selectTab、常驻 Web 实例和 Visibility 切换，不增加刷新或重建。官方文档未保证材质跨 ArkWeb 渲染面取样，因此不宣称能折射或模糊网页文字，实际材质、系统字体缩放与软键盘避让需真机验证。

规范依据：[Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)、[OpenHarmony背景模糊](https://github.com/openharmony/docs/blob/OpenHarmony-v7.0-Release/zh-cn/application-dev/reference/apis-arkui/arkui-ts/ts-universal-attributes-background.md)、[公开系统材质API26](https://github.com/openharmony/docs/blob/OpenHarmony-v7.0-Release/zh-cn/application-dev/reference/apis-arkui/arkts-apis-uimaterial.md)。系统沉浸材质在较早版本属于系统接口，本应用不在API23/24调用它。实际效果遵循设备算力和系统沉浸光感设置。

图标与可交互预览保存在 OpenDesign 项目 `codex-mobile-icons-final-20261019`。未将含联系人、聊天或IP的完整截图提交到设计项目或仓库。原生编译与真机显示是不同验证边界。

## 下载阈值设置

Harmony build 38 在 Codex 原生菜单加入独立的“下载设置”，沿用现有原生 Scroll、输入框及按钮样式，不改底栏、字体、UA 或网页。上限默认200 MB，接受1–4096的十进制整数，按1024×1024字节换算；偏好只写入 `bridge-computers` 的独立数值 key `downloadLimitMiB`。损坏或缺失的偏好使用200；无效值不会写入。写入或flush失败只尝试恢复此key，UI保持旧值并在面板提示失败。

面板与底栏外观绑定到不同的稳定原生组件，并互斥打开。打开时复制已保存值，取消、关闭或返回丢弃草稿；保存中禁止重复保存、关闭和返回，完成持久化后才更新已保存值。内容可滚动，按钮与输入框保留可访问名称，供窄屏及软键盘下操作；实际键盘与系统字体缩放仍需真机验证。

每次下载创建 `AttachmentDownload(downloadLimitBytes(savedLimit))` 时固定上限，调整偏好不会改变进行中或等待保存的文件预算。电脑网关自己的限制仍然生效，面板说明不会覆盖网关配置。保存设置不导航、不刷新或重建现有Web实例；App身份、Codex+名称与D图标保持。
