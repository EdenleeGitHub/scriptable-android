# Android 系统 API 兼容说明

此模块依据 [Scriptable 文档](https://docs.scriptable.app/) 的对象和方法名实现安卓等价能力。`runtime-system.js` 负责兼容脚本；`AndroidServices.java` 调用真正的 Android Provider、系统选择器和编辑器。异步公开 API 接入运行器的最终等待机制：即使脚本省略 `await`，原生失败也会显示为脚本错误。

## 能力和实际实现

| Scriptable API | 安卓实现 | 差异与实际约束 |
| --- | --- | --- |
| `Location.current()`、五种精度设置 | Android `LocationManager`，GPS/网络定位；30 秒超时，保留时间和实际精度 | 用户选择粗略定位时返回粗略结果；精度是目标，最终返回值包含实际精度。后台小组件需要事先在应用中授权，设备未安装网络定位服务时依赖 GPS。 |
| `Location.reverseGeocode()` | Android `Geocoder`，支持 locale 和标准地址字段 | 安卓服务异步调用，因此返回 Promise；没有地理编码服务、离线或服务失败会报错。 |
| `Calendar`、`CalendarEvent` | 真实 `CalendarContract`；日历读取、标题/颜色更新、删除；事件新增/修改/删除、系统实例查询、自己的可编辑日期表单 | 修改需要可写日历账户。没有日历账户时明确提示添加账户。全天事件写 UTC；重复事件通过 `Instances` 展开。Android 每个事件接受一个 RRULE，多条规则请建立多个事件。`presentEdit` 保留现有重复规则，表单提供标题、地点、备注、全天、开始和结束时间。 |
| 日/周事件快捷查询 | `today/tomorrow/yesterday/thisWeek/nextWeek/lastWeek/between` | 按本地日界和 locale 周起始计算。一次查询最多十年、2000 个事件。 |
| `Reminder` 和提醒日历 | 应用自己的持久任务/列表库；完成日期、创建日期、优先级、截止日期、所有完成/未完成/指定日期范围过滤；截止日期接入实际通知调度 | Android 没有通用的系统提醒事项 Provider，因此列表属于此应用，不会假装同步到 Google Tasks 或厂商待办。读取列表不会访问系统日历。保存有截止日期的任务会请求通知权限；拒绝通知时任务仍已保存，通知安排失败会明确报错。 |
| `RecurrenceRule` | 所有简单/复杂日、周、月、年工厂，包括截止日期、次数、星期/月日/月/年周/年日和 BYSETPOS 选择器，生成 RFC5545 RRULE | 星期 `1` 是星期日。事件重复由系统日历展开；重复提醒在完成本次任务后生成下一次任务，并安排下一条通知。提醒库采用本地时区，下一次日期查找范围为 100 年。 |
| `ContactsContainer`、`Contact`、`ContactsGroup` | 真实联系人账户、原始联系人、数据字段、群组与成员；`add/update/delete` 排队，`Contact.persistChanges()` 用 `applyBatch` 原子提交 | 联系人以账户所属的 Android raw contact 为单位，避免跨账户合并人物的编辑破坏；标识格式 `contact:<rawId>`。姓名、昵称、生日、邮件、电话、邮政地址、备注、链接、日期、组织/部门/职位、头像支持读取及修改；社交资料存为专用 Provider MIME 行，其他联系人应用不一定显示此自定义字段。一次提交最多 100 条对象变化、1000 个数据行；读取最多 2000 个原始联系人，较大通讯录可按账户或群组过滤。 |
| `Photos.fromLibrary/fromCamera` | 系统文档照片选择器；系统相机写入受 URI 授权的私有输出文件；实际解码、纠正 EXIF 方向并编码返回 Image | 使用外部相机时无需此应用申请 CAMERA 权限。返回图片最长边会降采样到不超过 2048 像素，透明图保持 PNG，其他图编码 JPEG。单项传输最多 3 MB。 |
| `Photos.latestPhoto(s)/latestScreenshot(s)` | 真实 MediaStore 按添加时间倒序读取 | 此类批量读取才申请图库权限；Android 的有限照片授权只会返回已授权的照片。截图根据英文截图文件名或英文/中文截图文件夹识别，厂商特殊命名可能无法识别。 |
| `Photos.save`、四种删除方法 | Scoped MediaStore；Android 11+ 批量系统删除确认；Android 10 可恢复权限逐张确认；旧安卓应用内确认后按授权删除 | 新安卓保存到 Pictures/Scriptable；旧安卓需要存储写权限。删除被取消会停止；Android 10 逐张确认时此前已确认删除的照片不会被恢复。没有任何方法会在运行测试时访问个人照片。 |
| `DocumentPicker.open/openFile/openFolder` | Storage Access Framework 系统选择器；选中的内容/文件夹复制到私有 `/documents/import-<UUID>`，并更新当前脚本的 FileManager 快照 | 返回的路径立刻可以通过同步 `FileManager.read/readString/readImage` 使用。文件夹导入是快照，外部文件夹的后续改动需要重新导入；需要持续云目录操作时使用应用的云目录功能。导入最多 200 项、12 层、3 MB 原始内容，并受整个脚本文件库的快照容量限制。失败会删除本次未完成的导入目录。 |
| `DocumentPicker.export/exportString/exportImage/exportData` | 系统创建文档选择器，向用户选定的目标 URI 写入真正的内容 | 返回内容 URI 数组。附加 `importString/importImage` 便利方法。用户取消会抛出可捕获的错误。 |
| `Dictation.start(locale)` | Android `RecognizerIntent` 语音识别界面 | 需要已安装的系统识别服务；服务管理它的麦克风权限。取消或无识别词时明确报错。 |
| `DatePicker` | 原生日期、时间和组合选择器；小时/分钟倒计时选择器 | 最小/最大日期验证；分钟按照指定间隔向下取整。可用间隔为 1、2、3、4、5、6、10、12、15、20、30；倒计时范围 0–86399 秒，精度为一分钟。 |
| `Mail`、`Message` | 外部邮件/SMS/MMS 撰写器；接收人、抄送/密送、标题、正文/HTML、图片/文件/二进制附件 | 方法只打开用户可审阅的撰写器，不自动发送。返回 `{status:'externalComposerOpened', sent:null}`：Android 无法可靠知道用户是否发送或取消。邮件发送账户偏好通过 Intent 交给邮件应用，由其决定是否采用；HTML 和附件支持取决于已安装撰写器。 |
| `Device.screenBrightness/setScreenBrightness/volume/identifierForVendor` | 同步原生读取；主线程窗口亮度更新；媒体流音量比例；Android 签名/应用/用户范围的 Android ID | 亮度改变只影响本应用窗口，不需要全局系统设置写权限。后台小组件无法改变窗口亮度。标识不是硬件序列号。 |
| `Device` 六种方向判断、完整语言列表、原始屏幕像素、实时电池状态 | 显示方向/旋转、重力传感器（无重力传感器时低通滤波加速度计）、完整 `LocaleList`、Display 原始像素、系统电池 sticky broadcast | 竖屏/横屏判断采用应用当前显示方向，安卓锁定旋转时与物理姿态可能不同；朝上/朝下使用当前 Activity 的传感器数据。未采样、没有传感器或采样超过三秒时朝上/朝下均为 false。传感器只在有 Activity 的模块实例上注册，关闭时注销，后台小组件不会注册传感器。屏幕像素返回设备自然方向尺寸；充满但仍插电时不会被当作正在放电。 |

## 原生宿主接入

构造器支持 `AndroidServices(MainActivity, Callback)` 和 `AndroidServices(Context, Callback)`。后者用于无可见 Activity 的小组件脚本：已有授权的 Provider 查询、提醒库与定位可用；需要选择器、编辑器、请求权限、撰写器或窗口的调用会提示先打开应用。

`handles(action)`、`call(id, action, payload)`、活动/权限结果转发、`cancel(ids)`、`close()` 由宿主管理。停止脚本会取消待完成工作、关闭已跟踪的表单/外部选择器、停止定位监听；已经完成的 Provider 保存属于真实副作用，不能靠停止撤销。Android 仍显示的权限对话框会留下取消标记，授权结果不会重新执行已经停止的脚本。

同步接口 `AndroidServices.handleSync(Context, action, JSONObject)` 支持 `device.brightness/volume/identifier/setBrightness/orientation/screen/preferredLanguages/battery`；窗口更新在主线程执行，等待最多两秒。

Manifest 按实际 API 使用声明 `ACCESS_COARSE_LOCATION`、`ACCESS_FINE_LOCATION`、`READ_CALENDAR`、`WRITE_CALENDAR`、`READ_CONTACTS`、`WRITE_CONTACTS`、`READ_MEDIA_IMAGES`、`READ_EXTERNAL_STORAGE`（maxSdk32）、`WRITE_EXTERNAL_STORAGE`（maxSdk28）。此模块不在应用启动时申请权限。相机/附件使用：

```xml
<provider android:name=".AndroidServices$SharedContentProvider"
  android:authorities="${applicationId}.shared"
  android:exported="false"
  android:grantUriPermissions="true" />
```

共享 Provider 只允许访问具有不可预测 UUID 文件名的专用 shared 目录，外部应用需要 URI 授权；不会提供整个应用私有文件库。临时共享文件在下次初始化时清理超过一天的条目。

## 验证

`node --test tests/system.test.cjs` 覆盖真实 Worker 消息/最终等待合同的 21 项测试：权限失败传播、日期复原、事件保存、日历只读状态、提醒通知更新及重复实例、联系人排队原子提交和失败重试、同事务新建联系人/群组及成员引用、仅成员变更自动排队、文档导入快照与容量拒绝后的当前/下次运行可用性、照片编码、邮件/SMS 附件、选择器/听写取消、完整 RRULE 工厂、同步设备接口和当前 `api-inventory.json` 中全部系统 API 成员的对象面覆盖检查。测试宿主模拟 Provider 返回值，不读取用户个人数据、不打开外部发送界面；它们不能替代安卓设备的 Provider/相机/语音识别器验收。

依据：[Android 日历 Provider](https://developer.android.com/guide/topics/providers/calendar-provider)、[联系人 Provider](https://developer.android.com/guide/topics/providers/contacts-provider)、[共享媒体存储](https://developer.android.com/training/data-storage/shared/media)、[活动结果](https://developer.android.com/training/basics/intents/result)。
