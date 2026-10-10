# 第三方资源与归属

项目原创源码采用根目录 [MIT License](LICENSE)。第三方组件保留各自的版权和许可证；本项目许可证不替代下列组件的许可证。

| 组件 | 来源与版本 | 许可证及随附文件 |
| --- | --- | --- |
| Material Design Icons 字体 | [Templarian/MaterialDesign-Webfont](https://github.com/Templarian/MaterialDesign-Webfont)，`@mdi/font@7.4.47`，Pictogrammers / Austin Andrews | 字体与图标采用 Apache-2.0。保留 [APACHE-2.0.txt](app/src/main/assets/icons/APACHE-2.0.txt)、[MDI-LICENSE.txt](app/src/main/assets/icons/MDI-LICENSE.txt) 和 [NOTICE.txt](app/src/main/assets/icons/NOTICE.txt)。`mdi.ttf` 原样复制，`mdi-map.json` 从包中 CSS 映射转成 JSON；原包非字体/图标文件采用 MIT。 |
| SF 符号名称元数据 | [nandorojo/typescript-sf-symbols](https://github.com/nandorojo/typescript-sf-symbols)，`sf-symbols-typescript@2.2.0`，Copyright (c) 2023 Fernando Rojo | [SF-NAMES-LICENSE.txt](app/src/main/assets/icons/SF-NAMES-LICENSE.txt)，MIT。`sf-symbol-names.json` 从类型联合中提取名称并改成 JSON；不包含 Apple 字体或 SF Symbols 图形。 |
| Gradle Wrapper | [Gradle](https://github.com/gradle/gradle)，8.11.1 | Apache-2.0；`gradlew` 保留原脚本版权头，`gradle-wrapper.jar` 内保留 `META-INF/LICENSE`。 |
| Android Gradle Plugin | [Android 开发工具](https://developer.android.com/build)，8.7.3 | Apache-2.0；由 Gradle 获取，不将缓存分发到源码仓库。 |
| 开发与测试依赖 | `@napi-rs/canvas@1.0.10`（MIT）、Playwright 1.56.1（Apache-2.0）、JUnit 4.13.2（EPL-1.0）、Robolectric 4.16.1（MIT） | 分别由 npm / Gradle 获取，版本由 `package-lock.json` / `app/build.gradle` 记录。`node_modules` 和 Gradle 缓存不纳入 Git。 |

Android 平台 API 由 Android SDK 提供。该应用调用系统接口，不包含 Android 系统实现。

## 独立资源与接口参考

- 接口名称参考 [Scriptable 官方文档](https://docs.scriptable.app/)；`docs/api-inventory.json` 保留来源链接，仅记录公开成员索引。应用内中文说明与示例描述本项目的实现和安卓差异。
- 应用品牌图为独立生成的标志，设计来源和派生文件记录见 [design-brief.json](docs/design-brief.json)。没有使用官方 Scriptable 或 Apple logo。
- 通知提示音由 [notification-tones.py](tools/notification-tones.py) 合成，不包含第三方音频采样。
- SF 名称用于脚本兼容；实际绘制采用原创矢量或 Material Design Icons。无法对应的标识会明确暴露通用替代信息。

Scriptable、Apple、SF Symbols、Android 及相关名称属于各自权利人。本项目为独立实现，与 Scriptable 或 Apple 没有官方关联。
