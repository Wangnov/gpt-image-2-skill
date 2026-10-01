# AppImage 普通用户启动失败

AppImage/appimage.github.io#7516 对 v0.7.4 的检测在执行 AppRun.wrapped 时报告 Permission denied。实际提取发布包后，AppRun 是 0755，AppRun.wrapped 是 0770；在 Linux 中将后者以 root 所有权复制后，切换为 nobody 用户可以复现拒绝执行。

AppRun.wrapped 的 SHA-256 与 Tauri apprun-old 的 AppRun-x86_64 完全一致。Tauri 的 write_and_make_executable 将它设置为 0770，linuxdeploy 随后保留该权限。

Linux beforeBundleCommand 预置同一上游文件，校验固定 SHA-256 后设置 0755。最终 AppImage 在候选构建和正式上传前通过 unsquashfs 检查包内其他用户的读取、执行权限，并在 Xvfb 中运行至少 15 秒。runtime 自带解压会创建 0700 的私有目录，不用该临时目录判断包内权限。

来源：[目录检测](https://github.com/AppImage/appimage.github.io/pull/7516)、[Tauri 权限设置](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/linux/appimage/mod.rs)、[Tauri AppRun 缓存与复制](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs)、[上游启动器](https://github.com/tauri-apps/binary-releases/releases/tag/apprun-old)。
