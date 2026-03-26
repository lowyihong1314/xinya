# Android KVM / Headless Emulator 使用手册

这台 server 上的 Android 环境不是 `virsh`/libvirt 虚机，而是 Android SDK 自带的 headless emulator，通过 `/dev/kvm` 做硬件加速。

当前已确认状态：

- KVM 设备存在：`/dev/kvm`
- AVD 名称：`xinya_api35_atd`
- 当前 adb 序列号：`emulator-5554`
- 当前机型：`Google ATD built for x86_64`
- Android 版本：`15`
- 分辨率：`1080x2400`
- 密度：`420`
- App 包名：`com.xinya.app`
- MainActivity：`com.xinya.app/.MainActivity`

## 相关路径

```bash
Android 工具根目录: /home/yukang/android-build
JDK:              /home/yukang/android-build/jdk/jdk-17.0.11+9
Android SDK:      /home/yukang/android-build/sdk
AVD 目录:         /home/yukang/.android/avd/xinya_api35_atd.avd
启动脚本:         /home/yukang/android-build/start_xinya_emulator.sh
停止脚本:         /home/yukang/android-build/stop_xinya_emulator.sh
日志文件:         /home/yukang/android-build/xinya-emulator.log
tmux session:     xinya-emulator
```

## 1. 查看当前状态

```bash
tmux ls
```

```bash
export ANDROID_SDK_ROOT=/home/yukang/android-build/sdk
export PATH=$ANDROID_SDK_ROOT/platform-tools:$PATH
adb devices -l
```

如果已经启动，你会看到：

```bash
emulator-5554 device product:sdk_gslim_x86_64 model:Google_ATD_built_for_x86_64 device:emu64x
```

检查是否完成开机：

```bash
adb -s emulator-5554 shell getprop sys.boot_completed
```

返回 `1` 表示已启动完成。

## 2. 启动 emulator

直接使用现成脚本：

```bash
/home/yukang/android-build/start_xinya_emulator.sh
```

脚本会自动做这些事：

- 设置 `JAVA_HOME` / `ANDROID_SDK_ROOT` / `ANDROID_AVD_HOME`
- 检查 AVD 和 emulator binary 是否存在
- 用 `tmux` 创建后台 session：`xinya-emulator`
- 用 `sg kvm -c '...'` 方式启动 emulator
- 等待 `adb` 就绪并轮询 `sys.boot_completed`

当前真实启动参数如下：

```bash
emulator @xinya_api35_atd \
  -no-window \
  -no-audio \
  -no-boot-anim \
  -gpu swiftshader_indirect \
  -accel on \
  -no-snapshot \
  -no-snapshot-save \
  -camera-back none \
  -camera-front none \
  -memory 2048 \
  -cores 2 \
  -port 5554
```

说明：

- `-no-window`：无 GUI
- `-accel on`：启用 KVM 加速
- `-gpu swiftshader_indirect`：软件图形后端，适合服务器
- `-port 5554`：对应 adb 序列号 `emulator-5554`

## 3. 停止 emulator

```bash
/home/yukang/android-build/stop_xinya_emulator.sh
```

脚本会：

- 尝试 `adb -s emulator-5554 emu kill`
- 清理 pid 文件
- 关闭 `tmux` session `xinya-emulator`

## 4. 查看日志

看启动日志：

```bash
tail -f /home/yukang/android-build/xinya-emulator.log
```

当前日志里可以看到：

- emulator 版本：`36.4.10.0`
- system image：`android-35/google_atd/x86_64`
- `Boot completed`

看 tmux 后台会话：

```bash
tmux attach -t xinya-emulator
```

退出但不停止 session：

```bash
Ctrl-b d
```

## 5. 配置当前 shell 的 Android 环境

如果你要手动执行 `adb` / `emulator` / `avdmanager`，先 export：

```bash
export JAVA_HOME=/home/yukang/android-build/jdk/jdk-17.0.11+9
export ANDROID_SDK_ROOT=/home/yukang/android-build/sdk
export ANDROID_HOME=$ANDROID_SDK_ROOT
export ANDROID_AVD_HOME=/home/yukang/.android/avd
export PATH=$JAVA_HOME/bin:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/platform-tools:$PATH
```

列出 AVD：

```bash
emulator -list-avds
```

## 6. 与 emulator 交互

无 GUI 时主要靠 `adb`。

### 打开 shell

```bash
adb -s emulator-5554 shell
```

### 查看设备信息

```bash
adb -s emulator-5554 shell getprop ro.product.model
adb -s emulator-5554 shell getprop ro.build.version.release
adb -s emulator-5554 shell wm size
adb -s emulator-5554 shell wm density
```

### 启动 App

```bash
adb -s emulator-5554 shell am start -n com.xinya.app/.MainActivity
```

或者：

```bash
adb -s emulator-5554 shell monkey -p com.xinya.app -c android.intent.category.LAUNCHER 1
```

### 停止 App

```bash
adb -s emulator-5554 shell am force-stop com.xinya.app
```

### 模拟返回键 / Home / 解锁

```bash
adb -s emulator-5554 shell input keyevent 4
adb -s emulator-5554 shell input keyevent 3
adb -s emulator-5554 shell input keyevent 82
```

### 模拟点击 / 输入

```bash
adb -s emulator-5554 shell input tap 540 1200
adb -s emulator-5554 shell input text 'hello'
adb -s emulator-5554 shell input swipe 500 1800 500 400 300
```

## 7. 截图和录屏

因为没有 GUI，截图和录屏很重要。

### 截图

```bash
mkdir -p /tmp/xinya-emulator
adb -s emulator-5554 exec-out screencap -p > /tmp/xinya-emulator/screen.png
```

### 录屏

```bash
mkdir -p /tmp/xinya-emulator
adb -s emulator-5554 shell screenrecord /sdcard/demo.mp4
adb -s emulator-5554 pull /sdcard/demo.mp4 /tmp/xinya-emulator/demo.mp4
```

注意：

- `screenrecord` 默认手动 `Ctrl-C` 停止
- 如果录屏较长，建议及时 pull 回主机

## 8. 安装 / 卸载 APK

### 安装 debug APK

```bash
adb -s emulator-5554 install -r /home/yukang/flaskapp/xinya/frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

### 卸载 App

```bash
adb -s emulator-5554 uninstall com.xinya.app
```

### 查看是否已安装

```bash
adb -s emulator-5554 shell pm list packages | rg com.xinya.app
```

## 9. 本项目的推荐联调方式

如果你是在这台 server 上联调 `frontend` 的 Android App，推荐流程：

### 第一步：准备 emulator 版 web 资源

```bash
cd /home/yukang/flaskapp/xinya/frontend
npm run apk:prepare:emulator
```

这条命令会使用：

- `VITE_API_BASE=http://10.0.2.2:5102`
- `CAP_ANDROID_SCHEME=http`
- `CAP_CLEARTEXT=true`

这样 emulator 内的 WebView 可以访问宿主机 Flask 服务。

### 第二步：构建 debug APK

```bash
cd /home/yukang/flaskapp/xinya/frontend/android
./gradlew assembleDebug
```

### 第三步：安装到 emulator

```bash
adb -s emulator-5554 install -r /home/yukang/flaskapp/xinya/frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

### 第四步：启动 App

```bash
adb -s emulator-5554 shell am start -n com.xinya.app/.MainActivity
```

## 10. 查看 App 日志

只看当前 app 的日志，最实用。

先拿 pid：

```bash
PID=$(adb -s emulator-5554 shell pidof com.xinya.app | tr -d '\r')
echo "$PID"
```

然后看 logcat：

```bash
adb -s emulator-5554 logcat --pid="$PID"
```

如果想直接看全部日志：

```bash
adb -s emulator-5554 logcat
```

清空旧日志：

```bash
adb -s emulator-5554 logcat -c
```

## 11. 常见排查

### `adb devices` 看不到 emulator

先确认进程还在：

```bash
ps -ef | rg qemu-system-x86_64-headless
tmux ls
```

如果没有，就重新启动：

```bash
/home/yukang/android-build/start_xinya_emulator.sh
```

### emulator 卡住

先停掉再重启：

```bash
/home/yukang/android-build/stop_xinya_emulator.sh
/home/yukang/android-build/start_xinya_emulator.sh
```

### 看最近 80 行启动日志

```bash
tail -n 80 /home/yukang/android-build/xinya-emulator.log
```

### 确认是不是 boot 完成了

```bash
adb -s emulator-5554 shell getprop sys.boot_completed
```

### 确认 App Activity 是否存在

```bash
adb -s emulator-5554 shell cmd package resolve-activity --brief com.xinya.app
```

## 12. 相关补充

- 当前 server 上没发现 `scrcpy`
- 当前 server 上有 `ffmpeg` 和 `jq`
- 当前运行方式依赖 `tmux`
- 当前 emulator 会话名固定为 `xinya-emulator`

## 13. 一组最常用命令

```bash
# 启动
/home/yukang/android-build/start_xinya_emulator.sh

# 看设备
export ANDROID_SDK_ROOT=/home/yukang/android-build/sdk
export PATH=$ANDROID_SDK_ROOT/platform-tools:$PATH
adb devices -l

# 启动 app
adb -s emulator-5554 shell am start -n com.xinya.app/.MainActivity

# 截图
adb -s emulator-5554 exec-out screencap -p > /tmp/xinya-screen.png

# 安装 apk
adb -s emulator-5554 install -r /home/yukang/flaskapp/xinya/frontend/android/app/build/outputs/apk/debug/app-debug.apk

# 停止 emulator
/home/yukang/android-build/stop_xinya_emulator.sh
```
