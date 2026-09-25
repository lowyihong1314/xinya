# Dev Workflow

## 启动测试环境

项目根目录：

```bash
cd /home/keyin/flaskapp
```

第一次或者依赖有变化时，直接运行：

```bash
./devSetup.sh
```

这个脚本会自动做下面这些事：

- 检查 node >= 22（nvm 默认是 20 时自动切到 /usr/bin 的 22）
- 确保 `venv` 存在并激活，安装 `requirements.txt`
- `frontend/` 没有 `node_modules` 或 lockfile 更新过时执行 `npm ci`
- 有 `_token.py` 时执行 `flask db upgrade`（已是最新会跳过）
- 执行 `npm run build`
- 回到根目录运行 `python3 run.py`

常用参数：

```bash
./devSetup.sh --dev            # 用 vite dev server 热更新，后端另开终端跑 python3 run.py
./devSetup.sh --skip-build     # 不打前端包
./devSetup.sh --skip-migrate   # 不跑数据库迁移
```

启动成功后，测试地址是：

```text
http://127.0.0.1:5202
```

## 线上部署（/srv/flaskapp/xinya）

同一个脚本放在 `/srv/flaskapp/` 下就是部署模式，**不要加 sudo**（root 写出的 `static/vite` 文件普通用户删不掉）：

```bash
./devSetup.sh              # 迁移数据库 -> npm run build -> 重启 xinya_flask + xinya_socket -> 健康检查
./devSetup.sh --apk        # 再多打一个 APK/AAB（版本号取 frontend/mobile_version.env）
./devSetup.sh --skip-build # 只改了后端
./devSetup.sh --no-restart # 只打包不重启
./devSetup.sh --dry-run    # 只打印步骤
```

健康检查打 `http://127.0.0.1:5006/api/music/albums` 和 `http://127.0.0.1:8000/socket.io/`，失败会直接报错并提示看 `journalctl -u xinya_flask` / `xinya_socket`。
两个服务都要重启，因为 socket 服务（抢答广播、唱游房间、播放设备同步）是独立进程。

## 改完代码后 Git 怎么推

先看当前改了什么：

```bash
git status
```

把要提交的文件加入暂存区：

```bash
git add .
```

或者只加指定文件：

```bash
git add run.py app/paths.py requirements.txt devSetup.sh
```

提交：

```bash
git commit -m "describe your changes"
```

推送到当前分支 `v2`：

```bash
git push origin v2
```

## 上传文件放哪里（重要）

所有用户 / 后台上传的文件一律存 `DATA_ROOT`（`app/paths.py`，线上是
`/srv/flaskapp/xinya/database`，可用环境变量 `XINYA_DATA_ROOT` 覆盖）：

```python
from app.paths import DATA_ROOT, data_media_url

TARGET_DIR = DATA_ROOT / "my_feature"          # 保存目录
url = data_media_url("my_feature", filename)   # 存进 DB 的 URL：/media_file/my_feature/xxx.jpg
```

`/media_file/` 由 nginx 直接 alias 到 `DATA_ROOT`，找不到文件才回落给 Flask。

**不要**把上传文件写进 `static/` 或其它仓库目录 —— deploy 时的 `git pull` /
`checkout` 会把它们删掉或覆盖掉（2026-04-08 就这样弄丢了 3 月份上传的报名收费项
图片）。这几个目录已经写进 `.gitignore` 挡着了。

## 常用检查

看当前分支：

```bash
git branch --show-current
```

看远端：

```bash
git remote -v
```

看本地改动：

```bash
git status --short
```

## 现在这个仓库的情况

当前远端：

```text
origin git@github.com:lowyihong1314/xinya.git
```

当前分支：

```text
v2
```
# test push again