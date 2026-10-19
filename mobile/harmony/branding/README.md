# A 底栏 + C 图标

用户于2026-10-19最终明确选择A的底栏样式，搭配C的四个菜单图标与App图标。桌面名称为 Codex。

- `app.svg` 是原始全幅图；`app-background.svg` 与透明 `app-foreground.svg` 的组合与原图一致。
- `app-1024.png` 是原始SVG的1024px实色栅格图，供构建脚本复制到AppScope与entry生成资源；不依赖iOS图标。
- 八个24×24导航SVG位于 `entry/src/main/resources/base/media/nav_*.svg`，选中态使用相应服务的深色块面与浅色内部几何。
- 图形来自 OpenDesign 项目 `codex-mobile-icons-final-20261019` 四方向对比中的C，浅色底栏布局来自A；自动续作中断后由当前Codex补齐并通过官方文件工具装配。
- 颜色、尺寸与真机验证边界见 `../DESIGN.md`。不包含签名、账号或私人截图。
