# 更新 APK 指南

每次更新 App 只需三步：build → sync → 打包，然后把新 `.apk` 放到 `frontend/apk/`，网站的"账号"页会自动列出最新版本。

---

## 环境变量（每次新终端都要设）

```bash
export JAVA_HOME=~/android-build/jdk/jdk-21.0.3+9
export ANDROID_HOME=~/android-build/sdk
export PATH=$JAVA_HOME/bin:$PATH
```

> 可以把这三行加进 `~/.bashrc` 就不用每次手动 export 了。

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
/home/yukang/flaskapp/xinya/frontend/build_apk.sh
```

如果已经在项目目录：

```bash
cd /home/yukang/flaskapp/xinya/frontend
./build_apk.sh
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
- 如果不传，Gradle 默认使用 `versionCode=1`、`versionName=1.0`。
- APK/AAB 文件名仍然使用时间戳，不会自动带上 `VERSION_NAME`。

---

## 文件说明

| 路径 | 说明 |
|------|------|
| `frontend/apk_dist/` | Vite APK build 输出，**不提交 git** |
| `frontend/apk/*.apk` | 最终发布的 APK 文件，**不提交 git** |
| `frontend/android/` | Capacitor Android 工程，**提交 git**（build/ 等已排除） |
| `frontend/.env.apk` | APK 构建环境变量（`VITE_API_BASE`） |
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
需要签名 keystore，改用 `./gradlew assembleRelease`，并在 `android/app/build.gradle` 配置 `signingConfigs`。

**Q: 想改 App 名字或 icon**
- 名字：编辑 `frontend/capacitor.config.ts` 里的 `appName`，再 `npx cap sync android`
- Icon：把 1024×1024 png 放进来后用 `npx @capacitor/assets generate` 生成各尺寸
