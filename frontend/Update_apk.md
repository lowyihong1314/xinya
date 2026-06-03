# 更新 APK 指南

每次更新 App 只需三步：build → sync → 打包，然后把新 `.apk` 放到 `frontend/apk/`，网站的"账号"页会自动列出最新版本。

---

## Mobile App 升级 Checklist

目标：继续维护 React + Capacitor，不转 Flutter；React 负责 UI，Android/iOS 原生插件负责后台播放、系统媒体控制、缓存、Android Auto / CarPlay 等平台能力。

### 第一阶段：Repo 和依赖基础

- [x] 记录当前 APK / iOS / Android 升级 checklist。
- [x] 修正 `frontend/.gitignore`，避免 `apk/` 误忽略 `src/music/music_player/apk/` 源码目录。
- [x] 统一 `@capacitor/core`、`@capacitor/android`、`@capacitor/cli` 版本。
- [x] 加入 `@capacitor/ios` 依赖，为后续 iOS platform 做准备。
- [x] 加入 `frontend/.nvmrc` 和 `scripts/with_node22.sh`，让 Capacitor 8 命令使用 Node.js >= 22。
- [x] 确认 `npx cap --version` 和 `npm ls @capacitor/*` 正常。
- [x] 跑一次 `npm run build:apk` 验证 React APK bundle。
- [x] 跑一次 `npm run cap:sync` 验证 Android Capacitor sync。

### 第二阶段：安全和发布流程

- [x] 把 `.env.apk` 里的敏感值移到服务器环境变量或未提交的本机 env 文件。
- [x] 准备 `.env.apk.example`，只保留可公开的变量名称。
- [x] 把 Android release signing 密码从 `android/app/build.gradle` 移到本机 `signing.properties` / Gradle property / 环境变量。
- [x] 在 release 流程里强制设置 `VERSION_CODE` 和 `VERSION_NAME`。

### 第三阶段：iOS Platform

- [x] 执行 `npx cap add ios --packagemanager SPM` 生成 iOS Capacitor project。
- [x] 配置 iOS bundle id、display name、icon、splash。
- [ ] 配置 iOS signing team 和 provisioning profile。外部依赖：需要 Apple Developer Team、provisioning profile、macOS/Xcode。
- [x] 配置 iOS background audio capability。
- [x] 建立 iOS build / sync / archive 文档。

### 第四阶段：iOS Native Music

- [x] 实作 `NativeMusicPlugin.swift`，对齐 Android `NativeMusic` plugin 的 TypeScript interface。
- [x] 使用 `AVPlayer` 做 iOS 原生播放。
- [x] 使用 `AVAudioSession` 支持后台播放。
- [x] 使用 `MPNowPlayingInfoCenter` 显示锁屏 / Control Center 歌曲信息。
- [x] 使用 `MPRemoteCommandCenter` 支持播放、暂停、上一首、下一首、seek。
- [x] 实作 iOS album cover cache。
- [x] 实作 iOS response/media cache。
- [ ] 如果要 CarPlay，申请并配置 `com.apple.developer.carplay-audio` entitlement。外部依赖：需要 Apple 批准 CarPlay audio entitlement。

### 第五阶段：Android 后续现代化

- [x] 保持当前 `MusicService + MediaBrowserServiceCompat` 稳定。本地 compile/sync 验证已固化到 `npm run mobile:verify`。
- [x] 为 Android Auto 增加回归测试 checklist：app 可见、全部歌曲、专辑、封面、播放控制。
- [x] 评估从 legacy ExoPlayer `2.19.1` 迁移到 AndroidX Media3。
- [x] 给 native cache 加容量限制、LRU 清理、debug 页面和手机端媒体缓存空间设置。
- [x] APK album 多图片/视频上传改为 Android foreground service 后台上传。
- [x] iOS album 多图片/视频上传改为 `URLSession` background upload。

### 第六阶段：Mobile Auth / Cache 长期方案

- [x] 抽象 `frontend/src/mobile/native/*`，集中 `NativeMusic` plugin interface。
- [x] 继续迁移 `NativeMediaCache` / `NativeResponseCache` interface 到 `frontend/src/mobile/native/*`。
- [x] 设计 mobile token/session API，减少 native HTTP 对 WebView CookieManager 的依赖。
- [x] 新增后端 `mobile_session` 表、`/api/mobile/session/*` API 和 Flask-Login Bearer request loader。
- [x] Android 使用安全存储保存 token。
- [x] iOS 使用 Keychain 保存 token。
- [x] WebView `apiFetch()` 在 Android/iOS 原生 runtime 自动附带 Bearer token，并在临近过期时刷新。
- [x] 手机端账号页增加媒体缓存空间设置，默认 10GB，可配置 1-50GB。
- [x] logout 时同时清理 native queue、media cache、response cache。

### 本地收口状态

截至 2026-06-03，这台 Ubuntu server 可完成的 build/sync/compile/docs 工作已收口。最终本地验证命令：

```bash
cd /home/yukang/flaskapp/xinya/frontend
npm run mobile:verify
```

仍需外部环境完成的项目：

- iOS signing team / provisioning profile：需要 Apple Developer 账号和 macOS/Xcode。
- iOS Swift 完整编译与 Archive：需要 macOS/Xcode。
- CarPlay audio entitlement：需要 Apple 批准 `com.apple.developer.carplay-audio`。
- Android Auto checklist：需要 Android Auto 真机、模拟器或 Desktop Head Unit 环境逐项手测。

---

## 环境变量（每次新终端都要设）

Capacitor 8 需要 Node.js >= 22。当前 server 有系统 Node 22；如果 shell 被 nvm 的 Node 20 抢先，可以用下面任一方式：

```bash
cd /home/yukang/flaskapp/xinya/frontend
nvm use
```

或在这台 server 上临时优先使用系统 Node 22：

```bash
export PATH=/usr/bin:$PATH
```

`npm run cap:sync`、`npm run cap:open` 和 `build_apk.sh` 已经会通过 `scripts/with_node22.sh` 自动处理 Node 22。

```bash
export JAVA_HOME=~/android-build/jdk/jdk-21.0.3+9
export ANDROID_HOME=~/android-build/sdk
export PATH=$JAVA_HOME/bin:$PATH
```

> 可以把这三行加进 `~/.bashrc` 就不用每次手动 export 了。

### 本地总验证

本机可验证的 mobile build/sync/compile 流程已经收敛成一条命令：

```bash
cd /home/yukang/flaskapp/xinya/frontend
npm run mobile:verify
```

它会依次执行：

- `npx tsc --noEmit`
- `npm run build`
- `npm run build:apk`
- `npm run cap:sync:android`
- `android/gradlew assembleDebug`
- `npm run ios:prepare`
- `git diff --check`

注意：这条命令只能在 Linux 上验证 iOS Capacitor sync，不能替代 macOS/Xcode 的 Swift 编译、签名、Archive。

---

## Release 签名配置

Release signing 不再写死在 `android/app/build.gradle`。这台 server 已经使用未提交的本机文件：

```text
frontend/android/signing.properties
```

新环境请复制示例文件后填入真实值：

```bash
cd /home/yukang/flaskapp/xinya/frontend/android
cp signing.properties.example signing.properties
chmod 600 signing.properties
```

也可以使用环境变量：

```bash
export XINYA_RELEASE_STORE_FILE=utba-release.keystore
export XINYA_RELEASE_STORE_PASSWORD=...
export XINYA_RELEASE_KEY_ALIAS=...
export XINYA_RELEASE_KEY_PASSWORD=...
```

`signing.properties` 和 `app/utba-release.keystore` 都不能提交 git。

---

## 更新步骤

### 第一步：构建 React Bundle

```bash
cd /home/yukang/flaskapp/xinya/frontend
npm run build:apk
```

输出到 `frontend/apk_dist/`，API 全部指向 `https://utbabuddha.com`。

---

### 第二步：同步到 Android 工程

```bash
npx cap sync android
```

把 `apk_dist/` 的内容复制进 `android/app/src/main/assets/public/`。

### 本地模拟器联调

如果要在这台 server 的 headless Android emulator 上联调，请不要直接用生产 APK 配置。

原因：

- 正式 APK 使用 `https://utbabuddha.com`
- 模拟器内置页源是 `https://localhost`
- 如果你临时把 API 改成 `http://10.0.2.2:5102`，默认会被 WebView 当成 mixed content 挡掉

请改用这条本地联调链路：

```bash
cd /home/yukang/flaskapp/xinya/frontend
npm run apk:prepare:emulator
```

它会做两件事：

- `VITE_API_BASE=http://10.0.2.2:5102`
- `CAP_ANDROID_SCHEME=http CAP_CLEARTEXT=true`

这样 Android 模拟器里的 WebView 就能访问宿主机 Flask 服务。

---

## iOS 更新步骤

iOS project 已经生成在：

```text
frontend/ios/
```

当前使用 Swift Package Manager，依赖入口在：

```text
frontend/ios/App/CapApp-SPM/Package.swift
```

### 准备 iOS bundle

在任意环境可以先执行：

```bash
cd /home/yukang/flaskapp/xinya/frontend
npm run ios:prepare
```

这会执行：

- `npm run build:mobile`
- `npm run ios:assets`
- `npm run cap:sync:ios`

`ios:assets` 会用 `static/images/logo/log222o.png` 生成 iOS app icon 和 splash。

### 用 Xcode 打开

这一步需要 macOS + Xcode：

```bash
cd /home/yukang/flaskapp/xinya/frontend
npm run cap:open:ios
```

然后在 Xcode 里配置：

- Signing Team
- Provisioning Profile
- Bundle Identifier 确认为 `com.xinya.app`
- Version / Build Number

### iOS Archive

Archive 必须在 macOS/Xcode 环境执行。命令行参考：

```bash
cd /home/yukang/flaskapp/xinya/frontend/ios/App
xcodebuild \
  -project App.xcodeproj \
  -scheme App \
  -configuration Release \
  -archivePath build/UTBA.xcarchive \
  archive
```

实际发布还需要 Apple Developer signing、provisioning profile 和 export options。

本仓库已准备 export options 示例：

```text
frontend/ios/App/ExportOptions.plist.example
```

在 macOS/Xcode 环境复制成未提交的 `ExportOptions.plist`，填入真实 Team ID 和 provisioning profile 名称后，可用于：

```bash
cd /home/yukang/flaskapp/xinya/frontend/ios/App
xcodebuild \
  -exportArchive \
  -archivePath build/UTBA.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist ExportOptions.plist
```

### iOS 后台音频

`ios/App/App/Info.plist` 已加入：

```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
</array>
```

后续还需要实作 `NativeMusicPlugin.swift`，并使用 `AVAudioSession` / `AVPlayer` / `MPNowPlayingInfoCenter` / `MPRemoteCommandCenter` 才能真正播放后台音频。

---

## Android Auto 回归测试 Checklist

参考：

- Android Cars testing: `https://developer.android.com/training/cars/testing`
- Media browser service overview: `https://developer.android.com/training/cars/media/create-media-browser`

当前 Android Auto 入口：

- `frontend/android/app/src/main/AndroidManifest.xml`
- `frontend/android/app/src/main/res/xml/automotive_app_desc.xml`
- `frontend/android/app/src/main/java/com/xinya/app/MusicService.java`
- `frontend/android/app/src/main/java/com/xinya/app/AlbumArtProvider.java`

每次改 `MusicService`、`NativeMusicPlugin`、封面缓存、登录/session、queue API 后，都要跑下面 checklist。

### 启动和可见性

- [ ] 真机或 Android Auto 测试环境已启用 Android Auto developer mode / unknown sources。
- [ ] 安装当前 APK 后，UTBA 会出现在 Android Auto media app list。
- [ ] Android Auto 能连接 `MusicService`，不会因为 WebView Activity 没打开而崩溃。
- [ ] force stop app 后直接从 Android Auto 打开，root menu 仍可加载。
- [ ] clear app data 后直接从 Android Auto 打开，未登录/无 cookie 时有可接受的空态或错误态，不崩溃。
- [ ] App 已登录、但 WebView Activity 未打开时，`MusicService` 能从 cookie/catalog cache 或 API 取得 catalog。

### 浏览树

- [ ] Root 显示 `全部歌曲` 和 `专辑`。
- [ ] `全部歌曲` 下能列出歌曲，标题、专辑名正确。
- [ ] `全部歌曲` 顺序和 React 前端一致：按 `play_minutes` 降序，同分保留 catalog 原顺序。
- [ ] `专辑` 下能列出专辑，数量和封面正确。
- [ ] 点进单个专辑后只显示该专辑歌曲。
- [ ] catalog API 失败时，能保留最近一次缓存 catalog；没有缓存时返回空列表，不 crash。

### 封面和缓存

- [ ] Android Auto 列表封面能显示。
- [ ] 播放页 / notification 封面能显示。
- [ ] 网络断开后，最近加载过的封面仍能显示。
- [ ] 默认封面 `defult.jpeg` 能在缺图时显示。

### 播放控制

- [ ] 从 `全部歌曲` 点歌能播放。
- [ ] 从专辑内点歌能播放，并以专辑上下文生成 queue。
- [ ] 播放、暂停、上一首、下一首按钮有效。
- [ ] 蓝牙/车机实体 media button 能控制播放。
- [ ] Seek 后 native snapshot 的 `progressMs` 更新。
- [ ] 播放结束后能自动下一首；最后一首在 repeat off 时停止或发出 `trackEnded`。
- [ ] shuffle / repeat 状态和手机 App UI 保持一致。

### 搜索和状态同步

- [ ] Android Auto 搜索能返回相关歌曲。
- [ ] Android Auto 发起播放后，手机 WebView 打开 APK 页面时能看到当前曲目和 queue。
- [ ] 手机 App 清空 queue 后，Android Auto 播放状态同步停止。
- [ ] logout 后，Android Auto queue 清空，response/media cache 清理。

### APK 听歌记录

- [x] 已登录用户在 APK 能看到 `听歌记录` / `Listening Activity` 页签，不需要 `music_edit`。
- [x] `Listening Activity` 能显示后端 `minute_logs`，包含带小数秒的 `isoformat()` 时间。
- [x] `add_one_minute` 只有已登录用户可写入 minute log，不需要 `music_edit`，未登录返回 401。
- [x] 切到 `Listening Activity` 时会刷新数据；停留该页时约每分钟刷新一次。

KVM 验证：2026-06-03 用 `lowyihong` 登录后，`NativeAuth.setSession` 成功，`GET /api/music/minute_logs` 返回 200，`POST /api/music/add_one_minute/<music_id>` 返回 200，`/#/music/music_player/history` 显示 `LISTENING ACTIVITY`。

### Album Cover 加载

- [x] album cover 上传改为服务端压缩保存，最长边限制 1200px，JPEG quality 82，避免手机端列表加载原始大图。
- [x] `/api/music/album_cover/<filename>` 增加 30 天 `Cache-Control`，减少重复请求。
- [x] 2026-06-03 已压缩 `/srv/flaskapp/xinya/database/album_image` 现有 JPG/JPEG 封面；例如 `10.jpg` 从约 2MB 降到约 20KB，`35.jpg` 从约 580KB 降到约 104KB。

---

## Media3 迁移评估

参考：

- AndroidX Media3 migration guide: `https://developer.android.com/media/media3/exoplayer/migration-guide`
- ExoPlayer to Media3 mappings: `https://developer.android.com/media/media3/exoplayer/mappings`

当前状态：

- `android/app/build.gradle` 使用 `com.google.android.exoplayer:exoplayer:2.19.1`。
- `MusicService.java` 使用 legacy `com.google.android.exoplayer2.*`、`MediaSessionCompat`、`MediaBrowserServiceCompat`。
- Android Auto 依赖 `MediaBrowserServiceCompat` browse tree、`MediaSessionCompat` playback token、`AlbumArtProvider`。
- `NativeMusicPlugin.java` 直接调用 `MusicService`，并把 queue/catalog/session 状态同步给 WebView。

结论：

- 应迁移，但不要和 iOS Native Music、release signing、token/session 改造混在同一个发布。
- 不建议只替换 ExoPlayer dependency；官方迁移范围还包括 `MediaBrowserServiceCompat` → `MediaLibraryService`、`MediaSessionCompat` → Media3 session/controller。半迁移会让 Android Auto 和 notification/session 更难验证。
- 建议在单独分支做 Media3 spike：先跑官方 migration script，再手动整理 `MusicService`、media source、notification、browser tree、remote controls。
- spike 完成标准不是“能编译”，而是上面的 Android Auto checklist 全部通过。

建议迁移步骤：

1. 建立单独分支，保留当前 ExoPlayer 2.19.1 可发布版本。
2. 用官方 migration script 生成初始 diff，只接受能解释的变更。
3. 把 `MusicService` 改为 Media3 `MediaLibraryService` / `MediaSession` 模型。
4. 把 media source / HTTP cookie header / cached file URI 播放逻辑迁到 Media3 等价 API。
5. 重新验证 Android notification、锁屏控制、蓝牙按钮、Android Auto browse/search/playback。
6. 通过 Android Auto checklist 后，再考虑合并到 release 分支。

---

## Native Cache 容量和调试

已落地：

- Android/iOS `NativeMediaCache` 使用 app cache 目录保存 event 图片/视频等媒体缓存。
- Android/iOS `NativeMediaCache` 默认上限 10 GB，可在手机端账号页调整为 1-50 GB。
- Android/iOS `NativeResponseCache` 默认上限 20 MB。
- 写入后自动按 `updatedAt` LRU 裁剪，读取/复用缓存时刷新 `updatedAt`。
- event 图片路径 `smartImageURL()` / `smartMediaAsset()` 会进入 `NativeMediaCache`；命中缓存时先返回本机文件，并用 stale-while-revalidate 后台刷新。
- TS bridge 增加 `getStats()` / `trim()` / `setMaxBytes()`。
- 手机端账号页增加本机缓存调试卡，可调整 media cache 空间、刷新、裁剪、清空 media/response cache。

---

## Mobile Album 后台上传

已落地：

- Android/iOS 相册上传不再使用 WebView `File` + XHR 队列，改为 `NativeAlbumUpload` plugin 调系统文件选择器。
- Android 使用 `NativeAlbumUploadService` foreground service 顺序上传选中的 `content://` 文件，用户关闭上传弹窗或 App 进入后台后继续上传。
- iOS 使用 `NativeAlbumUploadPlugin.swift` + `URLSessionConfiguration.background` 上传 multipart 临时文件，App 进入后台后继续上传。
- 上传鉴权优先使用 native auth 的 `Authorization: Bearer ...`；没有 native token 时 fallback 到当前 WebView cookie。
- 前端上传弹窗在 Android/iOS 原生 runtime 下轮询 native status，任务完成、部分完成或取消后保留状态；只要有成功上传项就刷新照片墙。
- 普通 Web 上传路径保持原有 `uploadEventMedia()` XHR 行为。

---

## Mobile Token / Session API 设计

目标：Native HTTP 不再依赖 WebView `CookieManager`。WebView 仍可用现有 cookie session；Android/iOS native plugin 用独立 mobile token/session，并存进平台安全存储。

当前问题：

- Android `MusicService` / native cache 在 WebView Activity 未启动时，可能读不到新 cookie。
- Android Auto 会先启动 `MediaBrowserServiceCompat`，不保证 WebView 已经打开。
- iOS 后台播放、锁屏控制、Keychain 存储也不适合依赖 WebView cookie。
- logout 需要同时撤销 server token、清 native queue/cache、清 WebView cookie。

### 后端 API

已落地，所有接口都走 HTTPS。

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/mobile/session/login` | 移动端优先入口：username/password 登录，同时设置 WebView cookie 并返回 mobile session。 |
| `POST` | `/api/mobile/session/exchange` | 用当前 WebView cookie 或 Bearer 登录态补发 mobile session，兼容旧 cookie 登录用户。 |
| `POST` | `/api/mobile/session/refresh` | 用 refresh token 换新 access token。 |
| `GET` | `/api/mobile/session/me` | 校验当前 mobile access token，返回 user summary。 |
| `DELETE` | `/api/mobile/session/logout` | 撤销当前 mobile session。 |
| `DELETE` | `/api/mobile/session/logout_all` | 撤销当前用户全部 mobile sessions，可用于改密码后。 |

token 模型：

- `access_token`: 短期，默认 30 分钟，用 `Authorization: Bearer ...` 认证。
- `refresh_token`: 长期，默认 90 天；只保存 SHA-256 hash，每次 refresh 轮换。
- `session_id`: server 生成，写入 access token payload。
- `device_id`: WebView 首次启动生成并保存到本机 localStorage，用于审计和后续撤销。
- `login_version`: 创建 session 时固化；改密码/重置密码后 refresh token 不再续期。

返回示例：

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": "2026-06-03T12:30:00Z",
  "user": {
    "id": 1,
    "username": "admin",
    "display_name": "Admin"
  }
}
```

Native HTTP header：

```text
Authorization: Bearer <access_token>
```

### NativeAuth Plugin

TypeScript bridge 已落地在：

```text
frontend/src/mobile/native/authPlugin.ts
```

Android native plugin 已落地在：

```text
frontend/android/app/src/main/java/com/xinya/app/NativeAuthPlugin.java
```

Android 使用 Android Keystore AES-GCM 加密 token payload，再写入 private `SharedPreferences`。

iOS native plugin 已落地在：

```text
frontend/ios/App/App/NativeAuthPlugin.swift
```

iOS 使用 Keychain generic password 保存 token payload，`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`。

当前方法：

```ts
export interface NativeAuthPlugin {
  getSession(): Promise<{ accessToken?: string; expiresAt?: string; user?: unknown }>;
  setSession(options: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    user?: unknown;
  }): Promise<void>;
  refreshSession(options: { baseUrl: string }): Promise<{ accessToken: string; expiresAt: string }>;
  clearSession(): Promise<void>;
}
```

### 前端 / Native 调用流程

登录：

1. Android/iOS 原生 runtime 优先调用 `/api/mobile/session/login`。
2. 后端同时设置 WebView cookie，并返回 `access_token` / `refresh_token` / `expires_at`。
3. WebView 把返回 token 交给 `NativeAuth.setSession()`。
4. 普通页面 API 通过 `apiFetch()` 自动附带 Bearer token；cookie 仍作为 WebView 兼容路径保留。
5. `NativeMusic`、`NativeMediaCache`、`NativeResponseCache`、`NativeAlbumUpload` 后续 native HTTP 优先用 `Authorization` header。
6. 如果老用户已有 cookie 但没有 native token，`refreshUser()` 会调用 `/api/mobile/session/exchange` 补发。
7. 如果 native token 不存在，短期内 native plugin 仍 fallback 到 CookieManager，避免一次性切换风险。

刷新：

1. `apiFetch()` / Native plugin 检查 `expires_at`。
2. access token 过期前调用 `/api/mobile/session/refresh`，后端轮换 refresh token。
3. refresh 失败时清本机 session；如果 cookie 仍有效，WebView 会重新 exchange；否则回到登录态。

Logout：

1. WebView 调 `/api/user_control/logout` 清 web cookie。
2. 调 `/api/mobile/session/logout` 撤销当前 mobile session。
3. 调 `clearMobileNativeSessionState()`，清 native token、music queue、media cache、response cache。

### 后端表设计草案

```text
mobile_session
- id
- user_id
- device_id
- refresh_token_hash
- user_agent
- platform
- login_version
- created_at
- refreshed_at
- expires_at
- revoked_at
```

### 分阶段落地

1. 新增后端 `mobile_session` 表和 exchange/refresh/logout API。已完成。
2. 新增 `NativeAuth` TS bridge。已完成。
3. Android 用 Keystore 保存 token。已完成。
4. iOS 用 Keychain 保存 token。已完成。
5. `NativeMusicRepository`、Android/iOS media cache 改为优先用 Bearer token。已完成基础落地。
6. `NativeAlbumUpload` 后台上传改为优先用 Bearer token。已完成。
7. `apiFetch()` 在 mobile native runtime 自动附带 Bearer token。已完成。
8. 删除或降级 CookieManager fallback。暂保留，用于线上观察期兜底。

已落地的 Bearer token 优先路径：

- Android `NativeMusicRepository` / `MusicService` / `NativeMusicPlugin` / `NativeMediaCache` / `AlbumArtProvider` 会优先读取 Keystore session 并发送 `Authorization`。
- Android `NativeAlbumUploadService` 会优先读取 Keystore session 并发送 `Authorization`，关闭上传弹窗或进入后台后继续上传。
- iOS `NativeMusicPlugin` / `NativeMediaCache` / `NativeAlbumUploadPlugin` 会优先读取 Keychain session 并发送 `Authorization`。
- WebView `apiFetch()` 在 mobile native runtime 下也会优先发送 `Authorization`，cookie 失效但 mobile token 有效时仍能读取 `/api/user_control/get_user_data`。
- 没有 native token 时，仍 fallback 到 WebView cookie，避免影响现有登录和播放路径。

---

### 第三步：打包 APK

```bash
cd android
./gradlew assembleDebug
```

生成位置：`android/app/build/outputs/apk/debug/app-debug.apk`

---

### 第四步：发布（重命名 + 放到 apk 目录）

```bash
# 回到 frontend 目录
cd ..

# 用版本号或日期命名，方便区分多个版本
cp android/app/build/outputs/apk/debug/app-debug.apk apk/UTBA_v1.1.apk

# 或者直接覆盖 UTBA.apk（只保留最新版）
cp android/app/build/outputs/apk/debug/app-debug.apk apk/UTBA.apk
```

> `frontend/apk/` 里的**所有 `.apk` 文件**都会自动出现在网站"账号 → 下载 App"列表里，按修改时间倒序排列（最新的在最前）。

---

## 推荐：使用一键脚本

现有脚本是 `frontend/build_apk.sh`，会自动完成：

- 构建 React APK bundle
- 生成 Android launcher icon 和 splash logo
- `npx cap sync android`
- 打包 signed release APK 和 AAB
- 复制成带时间戳的文件到 `frontend/apk/` 和 `frontend/aab/`

从任意目录执行都可以：

```bash
VERSION_CODE=12 VERSION_NAME=1.2.3 /home/yukang/flaskapp/xinya/frontend/build_apk.sh
```

如果已经在项目目录：

```bash
cd /home/yukang/flaskapp/xinya/frontend
VERSION_CODE=12 VERSION_NAME=1.2.3 ./build_apk.sh
```

输出文件格式：

```text
frontend/apk/UTBA_BETA_YYYYMMDD_HHMM.apk
frontend/aab/UTBA_BETA_YYYYMMDD_HHMM.aab
```

### 指定 Android 版本号

脚本支持用环境变量传入 Android 版本：

```bash
VERSION_CODE=12 VERSION_NAME=1.2.3 ./build_apk.sh
```

从 `frontend/` 外面执行：

```bash
VERSION_CODE=12 VERSION_NAME=1.2.3 /home/yukang/flaskapp/xinya/frontend/build_apk.sh
```

说明：

- `VERSION_CODE` 对应 Android `versionCode`，必须是正整数；每次发布新版通常要递增。
- `VERSION_NAME` 对应 Android `versionName`，是用户看到的版本号，例如 `1.2.3`。
- `build_apk.sh` 已强制要求同时传入 `VERSION_CODE` 和 `VERSION_NAME`。
- APK/AAB 文件名仍然使用时间戳，不会自动带上 `VERSION_NAME`。

---

## 文件说明

| 路径 | 说明 |
|------|------|
| `frontend/apk_dist/` | Vite APK build 输出，**不提交 git** |
| `frontend/apk/*.apk` | 最终发布的 APK 文件，**不提交 git** |
| `frontend/android/` | Capacitor Android 工程，**提交 git**（build/ 等已排除） |
| `frontend/ios/` | Capacitor iOS 工程，**提交 git**（public/config 等生成文件已排除） |
| `frontend/android/signing.properties.example` | Release signing 本机配置示例 |
| `frontend/.env.apk` | APK 构建环境变量（只放可公开的 `VITE_API_BASE`） |
| `frontend/.env.apk.example` | APK env 示例，方便新环境复制 |
| `frontend/capacitor.config.ts` | Capacitor 配置（appId、webDir） |

---

## 常见问题

**Q: `./gradlew assembleDebug` 报 `JAVA_HOME not set`**
```bash
export JAVA_HOME=~/android-build/jdk/jdk-21.0.3+9
export PATH=$JAVA_HOME/bin:$PATH
```

**Q: `cap sync` 报 `missing apk_dist`**
先跑 `npm run build:apk` 再 sync。

**Q: 想打 Release（非 Debug）APK**
需要签名 keystore 和本机 `android/signing.properties`。推荐直接用：

```bash
VERSION_CODE=12 VERSION_NAME=1.2.3 ./build_apk.sh
```

**Q: 想改 App 名字或 icon**
- 名字：编辑 `frontend/capacitor.config.ts` 里的 `appName`，再 `npx cap sync android`
- Icon：把 1024×1024 png 放进来后用 `npx @capacitor/assets generate` 生成各尺寸
