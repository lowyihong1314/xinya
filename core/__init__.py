"""core —— 与业务无关的地基层。

这里只放「整个应用都要用、但不属于任何一个业务模块」的东西：
配置读取（config.py）、数据库引擎、URL 前缀助手等。

铁律：core 不许 import app / models 里的任何东西。
app 依赖 core 是单向的，反过来就会在 Flask→FastAPI 迁移期间形成循环导入。
"""
