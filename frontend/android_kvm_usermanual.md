# Android KVM / Headless Emulator 使用手册

这台 server 上的 Android 环境是 Android SDK 自带的 **headless emulator**，通过 `/dev/kvm` 硬件加速运行，没有任何图形界面。

---

## ⚠️ 必读：三个关键事实

1. **截图永远是黑屏** — `-no-window -gpu swiftshader_indirect` 模式不渲染到 framebuffer，这是正常的，不代表 App 没跑。判断 App 状态要看 logcat 和 WebView JS 调试，不要看截图。

2. **只能用 debug APK 做 WebView JS 调试** — release APK 关闭了 WebView 远程调试，看不到 JS 状态。

3. **Gradle 必须用 JDK 21** — Capacitor 7.x 要求 JDK 21，用 JDK 17 会报 `invalid source release: 21`。

---

## 环境一览

| 项目 | 值 |
|------|-----|
| AVD 名称 | `xinya_api35_atd` |
| adb 序列号 | `emulator-5554` |
| App 包名 | `com.xinya.app` |
| MainActivity | `com.xinya.app/.MainActivity` |
| Android 版本 | 15（API 35） |
| JDK | `/home/yukang/android-build/jdk/jdk-21.0.3+9` |
| Android SDK | `/home/yukang/android-build/sdk` |
| 启动脚本 | `/home/yukang/android-build/start_xinya_emulator.sh` |
| 停止脚本 | `/home/yukang/android-build/stop_xinya_emulator.sh` |
| tmux session | `xinya-emulator` |

---

## 快速上手（从零到调试）

### 第一步：确认 emulator 在跑

```bash
export PATH=$PATH:/home/yukang/android-build/sdk/platform-tools
adb devices -l
```

正常应看到：
```
emulator-5554 device product:sdk_gslim_x86_64 model:Google_ATD_built_for_x86_64 device:emu64x
```

如果看不到，先启动：
```bash
/home/yukang/android-build/start_xinya_emulator.sh
# 等 30 秒后再 adb devices
```

### 第二步：构建并安装 debug APK

```bash
export PATH=$PATH:/home/yukang/android-build/sdk/platform-tools
export JAVA_HOME=/home/yukang/android-build/jdk/jdk-21.0.3+9
export ANDROID_HOME=/home/yukang/android-build/sdk
export PATH=$JAVA_HOME/bin:$PATH

cd /home/yukang/flaskapp/xinya/frontend
npm run build:apk          # 构建 JS bundle（指向 https://utbabuddha.com）
npx cap sync android       # 同步到 Android 项目
cd android
./gradlew assembleDebug    # 编译 debug APK

# 安装（签名不同时先卸载）
adb -s emulator-5554 uninstall com.xinya.app 2>/dev/null || true
adb -s emulator-5554 install android/app/build/outputs/apk/debug/app-debug.apk
```

### 第三步：启动 App

```bash
adb -s emulator-5554 logcat -c   # 清空旧日志
adb -s emulator-5554 shell am start -n com.xinya.app/.MainActivity
sleep 5   # 等 WebView 加载完
```

### 第四步：开启 WebView JS 调试

```bash
# 获取 App PID 并转发端口（一条命令）
PID=$(adb -s emulator-5554 shell pidof com.xinya.app | tr -d '\r') && \
adb -s emulator-5554 forward tcp:9222 localabstract:webview_devtools_remote_$PID && \
echo "PID=$PID, devtools ready"

# 获取页面 ID
PAGE_ID=$(curl -s http://localhost:9222/json | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")
echo "PAGE_ID=$PAGE_ID"
```

### 第五步：执行 JS（验证插件正常）

```bash
cd /home/yukang/flaskapp/xinya/frontend   # ws 模块在这里

node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:9222/devtools/page/$PAGE_ID');
ws.on('open', () => {
  ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{
    expression: \"JSON.stringify({plugins: Object.keys(Capacitor.Plugins), url: location.href})\",
    returnByValue: true
  }}));
});
ws.on('message', d => { console.log(JSON.parse(d.toString()).result?.result?.value); ws.close(); });
ws.on('error', e => console.error(e.message));
"
```

正常输出：`{"plugins":["NativeMusic","SystemBars","CapacitorCookies","WebView","CapacitorHttp"],"url":"https://localhost/"}`

---

## 常用 WebView JS 调试命令

> 所有 node 命令必须在 `/home/yukang/flaskapp/xinya/frontend` 目录执行，`ws` 模块在那里。
> 执行前先确保 `PAGE_ID` 变量已设置（见快速上手第四步）。

### 测试 NativeMusic 插件

```bash
cd /home/yukang/flaskapp/xinya/frontend
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:9222/devtools/page/$PAGE_ID');
ws.on('open', () => {
  ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{
    expression: \"Capacitor.Plugins.NativeMusic.ready().then(()=>'ok').catch(e=>'err:'+e.message)\",
    awaitPromise: true, returnByValue: true
  }}));
});
ws.on('message', d => { console.log(JSON.parse(d.toString()).result?.result?.value); ws.close(); });
ws.on('error', e => console.error(e.message));
"
```

### 测试 setPlaylist（用公开 MP3，跳过认证）

```bash
cd /home/yukang/flaskapp/xinya/frontend
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:9222/devtools/page/$PAGE_ID');
ws.on('open', () => {
  ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{
    expression: \`Capacitor.Plugins.NativeMusic.setPlaylist({
      tracks:[{id:1,url:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',title:'Test',album:'',coverUrl:''}],
      startIndex:0, repeatMode:'off'
    }).then(()=>'setPlaylist_ok').catch(e=>'setPlaylist_err:'+e.message)\`,
    awaitPromise: true, returnByValue: true
  }}));
});
ws.on('message', d => { console.log(JSON.parse(d.toString()).result?.result?.value); ws.close(); });
ws.on('error', e => console.error(e.message));
"
```

### 查播放进度

```bash
cd /home/yukang/flaskapp/xinya/frontend
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:9222/devtools/page/$PAGE_ID');
ws.on('open', () => {
  ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{
    expression: \"Capacitor.Plugins.NativeMusic.getProgress().then(p=>JSON.stringify(p)).catch(e=>'err:'+e.message)\",
    awaitPromise: true, returnByValue: true
  }}));
});
ws.on('message', d => { console.log(JSON.parse(d.toString()).result?.result?.value); ws.close(); });
ws.on('error', e => console.error(e.message));
"
# 播放中: {"positionMs":3200,"durationMs":267000,"isPlaying":true,"currentTrackId":1}
# 未播放: {"positionMs":0,"durationMs":0,"isPlaying":false,"currentTrackId":-1}
```

### 监听 JS console 实时输出（15 秒）

```bash
cd /home/yukang/flaskapp/xinya/frontend
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:9222/devtools/page/$PAGE_ID');
ws.on('open', () => {
  ws.send(JSON.stringify({id:1, method:'Runtime.enable'}));
  ws.send(JSON.stringify({id:2, method:'Log.enable'}));
});
ws.on('message', d => {
  const msg = JSON.parse(d.toString());
  if (msg.method === 'Runtime.consoleAPICalled') {
    const args = msg.params.args.map(a => a.value || a.description || '').join(' ');
    if (!args.includes('font-weight')) console.log('JS:', msg.params.type, args);
  }
  if (msg.method === 'Log.entryAdded') {
    console.log('LOG:', msg.params.entry.level, msg.params.entry.text);
  }
});
setTimeout(() => ws.close(), 15000);
ws.on('error', e => console.error(e.message));
"
```

---

## 查看 App 日志（logcat）

```bash
export PATH=$PATH:/home/yukang/android-build/sdk/platform-tools

# 清空旧日志
adb -s emulator-5554 logcat -c

# 只看本 App 的日志
PID=$(adb -s emulator-5554 shell pidof com.xinya.app | tr -d '\r')
adb -s emulator-5554 logcat --pid="$PID"

# 过滤关键信息（Capacitor 插件、音乐播放）
adb -s emulator-5554 logcat -d | grep -E "(Capacitor|NativeMusic|MusicService|ExoPlayer|Error|Exception)" | grep -v "ApkAssets\|CronetUrl"
```

---

## 构建说明

### 构建 debug APK（用于 emulator 调试）

```bash
export JAVA_HOME=/home/yukang/android-build/jdk/jdk-21.0.3+9
export ANDROID_HOME=/home/yukang/android-build/sdk
export PATH=$JAVA_HOME/bin:$PATH

cd /home/yukang/flaskapp/xinya/frontend
npm run build:apk && npx cap sync android
cd android && ./gradlew assembleDebug
# 输出: android/app/build/outputs/apk/debug/app-debug.apk
```

### 构建 release APK（用于真机测试）

```bash
cd /home/yukang/flaskapp/xinya/frontend
./build_apk.sh
# 输出在 frontend/apk/UTBA_BETA_<时间戳>.apk
```

### 构建 AAB（上传 Google Play）

```bash
export JAVA_HOME=/home/yukang/android-build/jdk/jdk-21.0.3+9
export ANDROID_HOME=/home/yukang/android-build/sdk
export PATH=$JAVA_HOME/bin:$PATH

cd /home/yukang/flaskapp/xinya/frontend
npm run build:apk && npx cap sync android
cd android && ./gradlew bundleRelease

VERSION=$(date +%Y%m%d_%H%M)
cp app/build/outputs/bundle/release/app-release.aab "../aab/UTBA_BETA_${VERSION}.aab"
```

### 构建 emulator 专用版（连接本地 Flask，可调试登录流程）

```bash
cd /home/yukang/flaskapp/xinya/frontend
npm run apk:prepare:emulator   # 使用 http://10.0.2.2:5102 作为后端
cd android && ./gradlew assembleDebug
```

> `10.0.2.2` 是 emulator 内访问宿主机的固定 IP。Flask 需在宿主机 5102 端口运行。

---

## 常用 adb 操作

```bash
export PATH=$PATH:/home/yukang/android-build/sdk/platform-tools

# 安装 APK（签名不同先卸载）
adb -s emulator-5554 uninstall com.xinya.app 2>/dev/null || true
adb -s emulator-5554 install <apk路径>

# 启动 / 停止 App
adb -s emulator-5554 shell am start -n com.xinya.app/.MainActivity
adb -s emulator-5554 shell am force-stop com.xinya.app

# 模拟按键（返回/Home/解锁）
adb -s emulator-5554 shell input keyevent 4    # 返回
adb -s emulator-5554 shell input keyevent 3    # Home
adb -s emulator-5554 shell input keyevent 82   # 解锁

# 截图（内容全黑是正常的，见顶部说明）
adb -s emulator-5554 exec-out screencap -p > /tmp/screen.png

# 查设备信息
adb -s emulator-5554 shell getprop ro.build.version.release
adb -s emulator-5554 shell wm size
```

---

## Emulator 管理

```bash
# 启动
/home/yukang/android-build/start_xinya_emulator.sh

# 停止
/home/yukang/android-build/stop_xinya_emulator.sh

# 查看启动日志
tail -f /home/yukang/android-build/xinya-emulator.log

# 查 tmux 会话
tmux ls
tmux attach -t xinya-emulator   # 进入（Ctrl-b d 退出不停止）
```

启动参数（供参考）：
```
-no-window -no-audio -no-boot-anim
-gpu swiftshader_indirect -accel on
-memory 2048 -cores 2 -port 5554
```

---

## 常见问题

**`adb devices` 看不到 emulator？**
```bash
ps -ef | grep qemu   # 确认进程在
/home/yukang/android-build/start_xinya_emulator.sh   # 重启
```

**`./gradlew` 报 `invalid source release: 21`？**
```bash
# 必须先 export JDK 21
export JAVA_HOME=/home/yukang/android-build/jdk/jdk-21.0.3+9
export PATH=$JAVA_HOME/bin:$PATH
```

**`adb install` 报签名冲突？**
```bash
adb -s emulator-5554 uninstall com.xinya.app
adb -s emulator-5554 install <apk>
```

**WebView 调试连不上？**
```bash
# App 每次重启 PID 变化，需重新 forward
PID=$(adb -s emulator-5554 shell pidof com.xinya.app | tr -d '\r')
adb -s emulator-5554 forward tcp:9222 localabstract:webview_devtools_remote_$PID
```

**`node -e` 报 `Cannot find module 'ws'`？**
```bash
cd /home/yukang/flaskapp/xinya/frontend   # 必须在这个目录执行
```
