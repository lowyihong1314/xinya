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

- 确保 `venv` 存在
- 激活 `venv`
- 安装 `requirements.txt` 里的 Python 依赖
- 进入 `frontend`
- 如果没有 `node_modules`，自动执行 `npm install`
- 执行 `npx vite build`
- 回到根目录运行 `python3 run.py`

启动成功后，测试地址是：

```text
http://127.0.0.1:5202
```

如果只是想手动启动，也可以这样：

```bash
cd /home/keyin/flaskapp
source venv/bin/activate
pip install -r requirements.txt
cd frontend
npx vite build
cd ..
python3 run.py
```

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