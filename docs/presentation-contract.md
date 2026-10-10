# Scriptable Android presentation implementation

The implementation follows the official [WebView](https://docs.scriptable.app/webview/), [UITable](https://docs.scriptable.app/uitable/), [UITableRow](https://docs.scriptable.app/uitablerow/), [UITableCell](https://docs.scriptable.app/uitablecell/), [CallbackURL](https://docs.scriptable.app/callbackurl/), [WidgetStack](https://docs.scriptable.app/widgetstack/) and [WidgetDate](https://docs.scriptable.app/widgetdate/) API contracts.

## Runtime extension

`runtime-ui.js` is imported after the base runtime has initialized `__runtime`. It registers WebView, UITable, UITableRow, UITableCell, CallbackURL, URLScheme, LinearGradient and WidgetDate. It expands ListWidget accessory preview methods and saves widget family, parameter and `config.widgetId` alongside the tree.

WebView supports instance loadURL/loadHTML/loadFile/loadRequest/evaluateJavaScript/getHTML/present/waitForLoad, static loadURL/loadHTML/loadFile/evaluateJavaScript, and an Android extension `close()`. Request loading uses the common HTTP transport, preserving arbitrary request methods, headers and bodies. HTML is rendered with the final response URL as its base. `shouldAllowRequest` is evaluated in the script worker; native navigation is held until the callback returns.

UITable supports mutable rows/cells, text/subtitles, base64 and URL images, buttons, relative cell widths, font/color/alignment, height, separators, selectable rows, button actions and reload while visible. Native table events execute JavaScript callbacks in the original worker. Async callbacks and callback failures participate in runtime completion tracking.

CallbackURL launches the target Android app with random-token x-success/x-error/x-cancel return URLs. It rejects cancellation, target errors, unavailable apps and a missing response after two minutes. URLScheme produces `scriptable-android://run`/`open` links; query arguments reach `args.queryParameters`. Safari.openInApp uses the isolated native browser surface.

## Native integration

Construct `NativePresentation(Activity, Callback)` on the UI thread. Callback exposes `resolve(String,Object)`, `reject(String,Exception)` and `event(String,JSONObject)`. Route actions accepted by `handles(String)` to `handle(String,String,JSONObject,String runId)` on the UI thread. Call `finishRun(String runId)` after completion to dispose hidden views, `cancel(Set<String>)` when stopping a run, `close()` on destruction, and `onIntent(Intent)` before normal URL dispatch to deliver x-callback results. A three-argument handle overload is available, but it does not attach a run owner for automatic cleanup.

All external/script HTML executes in separate native WebViews. They never receive the Android host interface. File access/content access/universal file URL access are disabled. Private file loading uses an HTTPS virtual origin with canonical-path checks and the app's private storage roots; that origin is accessible only to a view explicitly loaded with loadFile, and access ends if it navigates to an external page. JavaScript completion callbacks use evaluateJavascript polling rather than a privileged JS interface. TLS failures retain Android's default rejection behavior.

## Launcher widgets

The launcher uses a Canvas renderer for the full saved widget tree: horizontal/vertical nested stacks, fixed/flexible spacers, padding, size, text wrapping, line limits, fitting fonts, text/image alignment, opacity, shadows, images, image tint, backgrounds, linear gradients, rounded corners and borders. Dates support date/time/relative/offset/timer formatting at render time.

Each widget stores its own script ID, parameter, family, tree and refresh date. The launcher configuration screen selects a saved script, `args.widgetParameter` and family. A pin request's success callback binds the newly allocated widget ID. Rendering one script no longer overwrites unrelated widgets.

Provider contracts for background execution:

- `instanceConfigs(Context)` returns `{widgetId,scriptId,parameter,family,refreshAfterDate,updatedAt}` records.
- `save(Context,JSONObject)` respects an optional `targetWidgetId`; a background run must supply `config.widgetId`.
- `updateInstance(Context,int,JSONObject)` replaces only one widget tree.
- `requestPin(Context,JSONObject)` accepts optional scriptId/parameter/family and tree.
- `configure(Context,int,String,String,String)` updates one instance and requests a refresh.
- `refreshNow(Context)` requests a background run.

Provider calls `WidgetRefreshJob.schedule(Context)` and `WidgetRefreshJob.request(Context,int[] nullable)` when widgets are saved, configured, resized or restored. The platform still controls background timing; refreshAfterDate is a requested earliest date, not a guaranteed exact deadline. Android launcher rendering uses a bitmap with a 250000-pixel cap to limit RemoteViews memory. Individual node links use a transparent 8x8 hit grid, so very small link regions may share a tap area. Accessory widget families have home-screen equivalents because Android launchers do not expose the iOS lock-screen widget system.

Register `WidgetConfigureActivity` as exported with ACTION_APPWIDGET_CONFIGURE. Widget metadata references this activity. The existing ScriptWidgetProvider receiver handles explicit pin-result broadcasts, so it does not need a separate receiver.

## Browser preview

Load presentation-browser.js before bridge.js and delegate its accepted actions from Host.call, preserving `options.onEvent` and `options.runId`. Call PresentationBrowser.cancel(runId) when a run ends. HTML executes inside sandboxed opaque-origin iframes with only a per-frame postMessage evaluation channel. Local HTML evaluation, asynchronous completion, native-style table callbacks and local-file resource substitution work in browser preview. Inspecting remote URL source is subject to browser CORS; pages that disallow inspection can be displayed, but evaluation requires the Android app.

## Validation

`node --test tests/presentation.test.cjs` exercises request routing, WebView completion payloads, static loader cleanup, full request transport, table callbacks/reload/async failure handling, navigation decisions, encoded callback URLs, widget date/gradient metadata, per-widget identity and input validation. Android Canvas appearance and launcher-specific behavior still require device/emulator verification.
