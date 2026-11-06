# Agent Note: 鸿蒙网页拍照入口调用系统相机

Status: implemented

## Problem

Codey 远程页提供相机、照片和文件三个入口，相机 input 指定 `capture` 并接受 JPEG。鸿蒙外壳此前忽略 ArkWeb 的拍摄请求，全部交给文件选择器，相机入口因此没有打开相机。Codey 与原网关网页均可能在用户继续操作前异步读取选中的文件；相机返回后立刻删除文件会破坏这些读取。

## Decision

- ArkWeb `FileSelectorParam.isCapture()` 和 `getAcceptType()` 表示明确拍摄且接受 JPEG 时，调用 `cameraPicker.pick` 的 PHOTO 模式，后置镜头为默认。照片及普通文件仍分别发起原 DocumentViewPicker，保留从任意可选位置选择图片的能力；不改变 `selectUpload` 调用约定。
- 拍照前保留顶层真实用户动作、当前网关、非预览页和导航代次校验；手势异步校验和启动系统相机前再次检查前台、Codex 页签与完整 URL。返回后检查代次、网关、页签和完整 URL，但不要求前台：系统相机可能暂时使应用进入后台。完整 URL 比较覆盖原网关以 hash 切换聊天的路径，不宣称能识别所有不改变 URL 的页面状态变化。
- 系统相机只获得预先创建的应用私有缓存文件 URI。取消、失败、返回 URI 或媒体类型不匹配、空文件以及页面身份失效时不交付该文件；未交付文件立即删除。已经交付或回调结果未知的文件在整个进程生命周期保留，下次进程首次初始化只清理 `bridge-camera-<UUID>.jpg`，不触碰下载缓存或用户文件。每次选择回调仅调用一次，回调抛错不重放。
- 不开启 Web 文件访问权限、不申请相机或照片库权限，不改变 HTTP 网关、附件发送或服务端容量限制。Codey 既有图片和文件合计 4 MiB；相机结果不自动压缩，过大由网页原提示拒绝。

## API evidence

最低兼容 API 14；[OpenHarmony 5.0.2 ArkWeb 声明](https://github.com/openharmony/interface_sdk-js/blob/OpenHarmony-5.0.2-Release/api/%40internal/component/ets/web.d.ts)在 API 9 定义 `getAcceptType()`、`isCapture()` 和文件回调。不是 `isCaptureEnabled()`。
[系统相机指南](https://github.com/openharmony/docs/blob/OpenHarmony-5.0.2-Release/zh-cn/application-dev/media/camera/camera-picker.md)说明 CameraPicker 不需应用相机权限，指定已存在且可写的沙箱 `saveUri` 可避免保存到媒体库；[PickerResult 说明](https://github.com/openharmony/docs/blob/OpenHarmony-5.0.2-Release/zh-cn/application-dev/reference/apis-camera-kit/js-apis-cameraPicker.md)说明成功值、URI 和类型。ArkWeb 只暴露是否拍摄，不提供 `capture=user/environment` 镜头方向，因此默认后置，不声称识别了网页指定的镜头值。

## Existing-note audit

[鸿蒙 Codey 紧凑操作区](2026-11-04-harmony-codey-compact-controls.md)部分重叠在页面和导航边界，不涉及原生文件选择或缓存，保留并互链。Android 更新交接记录涉及下载包，不涉及网页拍照，无需变更；没有被本决定完全取代的活跃记录。

## Alternatives considered

- 保留原文件选择器只改相机文案无需新原生调用，但没有实现用户主动拍摄，因此不采用。
- 使用自建 Camera API 可控制照片尺寸和镜头，但需要更多权限、设备与生命周期处理；系统 CameraPicker 已覆盖用户确认的拍照需求。
- 为图片输入改用 PhotoViewPicker 可直接展示媒体图库，但原网关与 Codey 使用相同图片类型，可能让未入图库的文件不可选；保持原 DocumentViewPicker 以兼容已有调用。
- 返回相册媒体 URI 可省去私有文件，但会默认保存到公共照片库。使用私有文件避免新增图库内容，代价是要管理其生命周期和缓存空间。
- 立即删除已回调照片可更快回收空间，但网页可能延迟读取甚至等待用户操作；仅在确认未交付时立即删除，其余留到新进程首次初始化。

## Testing

`node --test tests/host-environment.test.cjs mobile/tests/*.test.cjs` 运行生产 ArkTS 逻辑的模拟测试；覆盖请求分流、后置系统相机参数、URI 和媒体校验、空结果、失败与取消、单次回调、手势后及相机返回后的过期导航与页签、系统相机导致的临时后台、专属缓存清理和正常读文件。相机、文件选择器与文件系统是模拟实现，不等于 ArkTS 编译、HAP 构建或真机验证。

## Consequences

应用不增加高权限或公开媒体库写入；已交付照片在进程存活期间占用私有缓存，系统可按自身策略回收缓存。当前未在真实鸿蒙设备验证相机返回前后台时序、ArkWeb `fileAccess(false)` 下 FileReader 读取授权 URI、不同机型的照片编码或 4 MiB 阈值提示。需要对应提交的 HAP 构建成功及用户另行授权后的真机验证，不能将模拟结果写成真实拍照通过。
