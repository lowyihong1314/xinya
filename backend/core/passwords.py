"""密码哈希 —— 替掉 flask_bcrypt，实现与它**逐字节等价**。

为什么不能随便换：库里已经存着一批 bcrypt 哈希，参数只要差一点
（轮数、前缀 2a/2b、是否先 sha256）老用户就全部登录不上。

原来用的是 ``flask_bcrypt.Bcrypt()``，而且全项目**从未调用过
init_app``，所以一直吃的是类属性默认值：

    _log_rounds            = 12
    _prefix                = '2b'
    _handle_long_passwords = False

下面照抄 flask_bcrypt 的 generate_password_hash / check_password_hash，
把这三个值写死。底层仍是同一个 ``bcrypt`` 包，行为不变。
"""

import hmac

import bcrypt as _bcrypt

# 与 flask_bcrypt 未 init_app 时的默认值一致，不要改
LOG_ROUNDS = 12
PREFIX = b"2b"


def _to_bytes(value):
    """照搬 flask_bcrypt._unicode_to_bytes：str 按 utf-8 编码，bytes 原样返回。"""
    if isinstance(value, str):
        return value.encode("utf-8")
    return value


def generate_password_hash(password, rounds=None, prefix=None):
    """生成哈希。返回 **bytes**（和 flask_bcrypt 一样），调用方自己 .decode()。"""
    if not password:
        raise ValueError("Password must be non-empty.")
    salt = _bcrypt.gensalt(
        rounds=LOG_ROUNDS if rounds is None else rounds,
        prefix=PREFIX if prefix is None else _to_bytes(prefix),
    )
    return _bcrypt.hashpw(_to_bytes(password), salt)


def check_password_hash(pw_hash, password):
    """校验。用 hmac.compare_digest 做定时安全比较，和 flask_bcrypt 一致。"""
    pw_hash = _to_bytes(pw_hash)
    password = _to_bytes(password)
    return hmac.compare_digest(_bcrypt.hashpw(password, pw_hash), pw_hash)
