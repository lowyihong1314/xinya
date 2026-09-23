"""后端包。

与 frontend/ 对称：所有 Python 代码都在这一层之下，仓库根只留
入口脚本（run.py）、配置（alembic.ini / system_config.env）和非代码目录。

子包职责：
  core/       基础设施，不含业务：配置、DB、鉴权、响应信封、URL、实时推送、路径
  api/        业务路由，一个模块一个包（router.py / service.py / schemas.py）
  models/     SQLAlchemy 模型
  migrations/ alembic
  app/        ★ 临时：还没搬到 api/ 的 Flask 蓝图。搬空后整个删掉，不要往里加东西。
"""
