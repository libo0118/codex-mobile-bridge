# HarmonyOS

ArkTS / ArkUI + ArkWeb 原生外壳，复用电脑网关的 `web/` 页面和 `mobile/shared/web/` 脚本。最低 API 14；具体编译 SDK、目标 API 和版本由本目录的工程配置及 GitHub Actions 固定。

## 使用

底部有 Codex、Keeper、CPA、Magpie 四个入口。首次打开一个管理站点才创建它的 Web 实例；之后仅切换可见性，不替换 URL、销毁实例或自动刷新。已打开页面的滚动位置、表单和运行中页面状态会保留。主动点击“刷新”、更改站点地址、系统回收进程或应用重启会重新加载；内存页面状态不会跨进程保留。

- **Codex**：在电脑网关展开“扫码登录”，使用 ScanKit 系统扫码界面或粘贴完整地址，核对网关后连接。配对码仍由网页通过 `/api/pair` 兑换 HttpOnly Cookie；外壳不另建认证流程。支持保存电脑、重命名、移除、原网页聊天/账号/文件界面、原生菜单与返回。
- **Keeper**：预置 `https://libo.siasunagv.cn/keeper/`。保留尾斜杠，避免站点无斜杠入口的 HTTP 降级重定向。
- **CPA**：首次点击后在应用内填写真实 HTTPS 管理地址，不预设未知服务器地址。
- **Magpie**：预置无密钥基址 `https://libo.siasunagv.cn/magpie/`，地址可配置。若服务返回 401 并要求启动链接，在“登录信息”选择“私密入口链接”，仅在本机输入启动服务时提供的完整 HTTPS 链接。

第三方管理页各自有独立 Web 控制器，不加载 Codex 原生脚本或桥接接口，不复制 Codex Cookie。Cookie / localStorage 遵循系统 Web 组件的来源与路径规则；同一域名下服务的 Cookie 是否共享也受服务端 Path 设置影响。非当前站点的顶层外链需用户操作和确认后在浏览器打开，不能自动降级到 HTTP。

## 记住登录和登录信息

网页登录后的 Cookie 与 localStorage 交由 ArkWeb 持久化；页面加载完成和应用进入后台时主动保存 Cookie。服务端设置过期、退出登录、撤销可信设备、清除应用数据仍可能要求重新登录。Codex 不将会话 Cookie 备份到 Preferences，首版也不包含 Android Keystore 对应的 Codex 凭据恢复和入口自动迁移。

管理页工具栏的“登录信息”由用户明确保存：

1. 选择“密码/管理密钥”，填写可选用户名和密码/管理密钥，点击“安全保存”。之后点“填入已保存”，应用仅填入当前主框架中唯一可见的密码框，派发输入事件，由用户确认登录。多个密码框或来源/路径不符时拒绝填入。
2. 选择“私密入口链接”，在本机粘贴完整的带密钥链接并安全保存。之后只有点击“打开安全入口”才加载该链接。链接必须属于该站点的 HTTPS 来源和配置路径；普通站点设置不接受含查询参数或片段的地址。
3. 需要时点击“删除已保存”。切换站点、离开登录信息面板或页面导航会清除面板中的临时明文。

保存的数据使用 HUKS 密钥加密，由 `CredentialVault` 绑定站点 ID 和 HTTPS 路径范围；加密或解密失败会报错，不退回明文存储。不自动抓取网页密码，不将密码写入 URL、普通 Preferences、JS localStorage 或日志；私密入口本身作为用户明确授权的导航 URL，仅在使用时交给网页组件。

## 文件与通知

- 上传调用系统文件选择器，返回前核对当前网关、导航代次和顶层真实用户动作。预览页不会获得上传或原生 prompt 权限。
- 原生附件下载仅接受当前网关的白名单附件端点。通过同源网页 `fetch(credentials: 'same-origin', redirect: 'error')` 请求，不把 Cookie 交给会自动跟随重定向的原生 HTTP 栈。检查响应长度并在流读取中硬性限制 **20 MiB**；超限提示改用浏览器或电脑。下载完整后才显示系统保存入口，取消、失败或下次启动会清理本应用的临时附件。
- 任务通知需要在 Codex 菜单开启并授予系统通知权限，同时在电脑网关开启“手机 App 通知收件箱”。仅当前已连接电脑、Codex 页签可见且应用在前台时巡检；首次读取、切回页签、恢复前台仅建立游标，不批量弹出历史提醒。发布成功后才确认通知游标；点击通知可返回已保存电脑的对应聊天。无后台保活或厂商云推送。

## 构建

从仓库根目录运行；不要提交生成的 rawfile 副本、SDK、安装包、签名或凭据。

```sh
python -B scripts/build-mobile-harmony.py --prepare-only
node --test mobile/tests/harmony-security.test.cjs mobile/tests/harmony-credentials.test.cjs
```

`--prepare-only` 仅复制原项目图标和三个共享脚本，不代表 ArkTS 编译。脚本名与注入顺序固定为 `mobile-ui.js`、`mobile-clipboard.js`、`mobile-system-bars.js`。

安装工程要求的 HarmonyOS CLI 工具，设置 `HOS_SDK_HOME`，将 `ohpm`、`hvigorw` 加入 PATH 后：

```sh
python -B scripts/build-mobile-harmony.py
```

构建脚本安装工程依赖、调用 Hvigor，并验证 HAP 中存在非空的 `ets/modules.abc`、模块与资源索引、正确应用身份和三个原样共享脚本。输出在 `dist/mobile-harmony/`，附带 SHA-256 和工具链/提交信息。

GitHub Actions 的 **HarmonyOS unsigned HAP** 工作流支持手动执行，并在指定鸿蒙分支相关文件更新后执行。成功后下载 `mobile-HarmonyOS-unsigned` artifact。CI 编译成功与真机操作验证是两种不同证据。

## 安装和验证范围

Actions 默认生成 **未签名 HAP**。安装到真实设备前，需要在自己的 HarmonyOS 开发环境中配置开发者签名与设备授权；应用签名、私钥和设备资料不提交仓库。保持同一应用身份和签名，才可按系统规则升级保留数据。

UA 包含真实 `BridgeMobile/2.1.1-HarmonyOS` 标记及旧网关兼容标记 `BridgeMobile/2.1.1-Android`。新网关优先识别 HarmonyOS，现成旧网关仍可沿用移动端绑定流程。UA 只用于宿主兼容提示；配对、Cookie、CSRF 与原生来源校验仍然适用。

Node 自检直接执行生产 ArkTS 纯函数和生成的页面脚本，覆盖共用 URL 夹具、网关/中继/令牌边界、重定向与下载失败、通知游标和登录填表边界。原生 ScanKit、HUKS、系统文件选择器、通知点击、软键盘/安全区和多 Web 实例呈现仍需 HAP 编译及真机验证；未有捕获的实机画面前不视为视觉验证通过。
