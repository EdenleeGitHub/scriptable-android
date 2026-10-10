# 参与开发

欢迎提交 Issue 和 Pull Request。报告问题时请附上 Android 版本、应用版本、最小可复现脚本、错误日志和预期结果；涉及界面适配时附屏幕尺寸或脱敏截图。

不要公开联系人、位置、照片、访问令牌、签名密钥或未脱敏的真实用户数据。系统 API 回归测试使用合成 fixtures。

## 本地开发

1. 安装 Node.js 22+、JDK 17 和 Android SDK（Platform 36、Build Tools 35.0.0）。
2. `npm ci`，然后 `npx playwright install chromium`。
3. 设置 `JAVA_HOME`、`ANDROID_HOME`，或在未纳入 Git 的 `local.properties` 中配置 `sdk.dir`。
4. 运行 `npm run preview`，或使用 Android Studio 打开根目录。

提交前按改动范围执行：

```sh
npm test
npm run test:ui
node tools/check-api-surface.cjs
./gradlew testDebugUnitTest assembleDebug lint
```

Windows 使用 `gradlew.bat`。首次执行 Gradle / Robolectric 测试需要下载依赖。

## 修改要求

- 运行时 API 的返回值、默认值、错误和取消路径应与安卓桥接一致。
- 涉及原生行为时增加安卓框架回归；浏览器模拟结果不能代表原生系统验收。
- 公开成员入口检查只证明入口存在，功能变更仍需行为测试。
- 涉及权限、相机、通知、组件或后台刷新时说明实际设备验证范围。
- 保留第三方归属和许可证。原创贡献按项目 MIT 许可证发布。
- 不提交构建缓存、APK、`local.properties` 或签名配置。官方 Release 签名保存在仓库外；自行构建使用自己的签名。
