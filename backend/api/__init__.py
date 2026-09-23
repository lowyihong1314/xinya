"""api —— FastAPI 路由层。

一个业务模块一个文件（api/twilio.py、api/user_control.py …），文件里**只做框架适配**：
参数提取（query / form / JSON / 上传文件）、权限装饰、把返回值收成 Response。
业务逻辑随模块一起搬进 api/<模块>/service.py，不在这里抄第二份 ——
迁移期两份逻辑一旦分叉，线上跑的是哪一份就说不清了。

路由统一在 backend/api/router.py 里 include_router 挂上去（main.py 只认那一条），
这里不 import backend.main，避免循环。
"""
