"""法会电话号码的统一处理。

历史上库里同时存在两套写法：公开登记页写入的 E.164（+60…），
和后台录入的本地写法（0…），而查订单是精确字符串匹配，
结果同一个人从公开页查不到自己后台录入的单。这里把规范化、
垃圾判定和「容错查询」收在一处，读写两边共用同一套规则。

规范化规则和前端 frontend/src/js/phone.ts 的 normalizePhoneMY 对齐，
额外多认一种新加坡号（65 + 8 位）和已经带 + 的国际号。
"""

from __future__ import annotations

import re

# 少于这个位数的一律当脏数据（"-"、"000"、"123" 这类占位符）
MIN_PHONE_DIGITS = 7


def phone_digits(value) -> str:
    return re.sub(r"\D", "", str(value or ""))


def canonical_phone(value) -> str:
    """去掉国家码 / 前导 0 之后的核心号码，只用来比对两个号是不是同一个。"""
    digits = phone_digits(value)
    if digits.startswith("60"):
        digits = digits[2:]
    if digits.startswith("0"):
        digits = digits[1:]
    return digits


def is_junk_phone(value) -> bool:
    """明显不是电话号码：空、太短、或者整串同一个数字。"""
    digits = phone_digits(value)
    if len(digits) < MIN_PHONE_DIGITS:
        return True
    return len(set(digits)) == 1


def normalize_phone(value) -> str | None:
    """能确定归属就返回 E.164（+60… / +65…），认不出来返回 None，由调用方决定保留还是清掉。

    座机（07…，位数不够 10 位）这类认不出来的一律原样保留 —— 它们是真号码，
    只是收不了 OTP，硬转成 +60 也没有意义。
    """
    raw = str(value or "").strip()
    digits = phone_digits(raw)
    if not digits or is_junk_phone(raw):
        return None

    # 马来西亚手机：0XXXXXXXXX / 60XXXXXXXXX / 1XXXXXXXX
    if digits.startswith("0") and 10 <= len(digits) <= 11:
        return f"+60{digits[1:]}"
    if digits.startswith("60") and 11 <= len(digits) <= 12:
        return f"+{digits}"
    if digits.startswith("1") and 9 <= len(digits) <= 10:
        return f"+60{digits}"

    # 新加坡手机：65 + 8 位（法会常年有几位新加坡的功德主）
    if digits.startswith("65") and len(digits) == 10:
        return f"+{digits}"

    # 已经写成国际格式的，统一成「+ 纯数字」
    if raw.startswith("+") and 10 <= len(digits) <= 15:
        return f"+{digits}"

    return None


def normalize_phone_for_storage(value) -> str | None:
    """写库用：能规范就规范，垃圾直接清成 None，其余原样保留。"""
    raw = str(value or "").strip()
    if not raw:
        return None
    if is_junk_phone(raw):
        return None
    return normalize_phone(raw) or raw


def phone_lookup_variants(value) -> list[str]:
    """查询用：把一个号码摊开成库里可能出现的各种写法，配 IN 使用。

    这样公开页拿 +60… 也能查到后台录入成 0… 的旧单，不用先把数据洗干净。
    """
    raw = str(value or "").strip()
    variants = {raw} if raw else set()

    normalized = normalize_phone(raw)
    if normalized:
        variants.add(normalized)

    core = canonical_phone(raw)
    if core and len(core) >= MIN_PHONE_DIGITS:
        variants.update({f"+60{core}", f"60{core}", f"0{core}", core})

    return sorted(variant for variant in variants if variant)
