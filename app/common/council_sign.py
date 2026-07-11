"""Scope-agnostic 理事会（council）签名审批流程。

会员（membership）与青少年佛学班（youth_class）共用同一套理事会签名逻辑：
- 永久登录门槛的签名链接（token 内含 {scope, registration_id}）
- 签名以 JSON 笔画（strokes）保存，并附带签名理事的 user_data 快照
- 收集到 scope 规定的签名数量（配合财政通过）即生效
每个 scope 通过 register_scope() 注册自己的模型、激活回调与序列化器。
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

from flask import current_app, jsonify, request
from flask_login import current_user
from itsdangerous import BadSignature, URLSafeSerializer
from sqlalchemy.exc import IntegrityError

from app.auth import get_current_user_permissions
from models import db

COUNCIL_SIGN_SALT = "council-sign"
COUNCIL_PERMISSION = "council_approve"


@dataclass
class CouncilScope:
    scope: str
    signature_model: Any
    fk_attr: str
    signatures_attr: str
    max_signatures: int
    get_registration: Callable[[int], Any]
    applicant_name: Callable[[Any], str]
    consent_object: str
    org_name: str
    activate: Callable[[Any], bool]
    serialize: Callable[[Any], dict]


_REGISTRY: dict = {}


def register_scope(cfg: CouncilScope):
    _REGISTRY[cfg.scope] = cfg


def get_scope(scope):
    return _REGISTRY.get(scope)


def _clean_text(value):
    normalized = str(value or "").strip()
    return normalized or None


def _serializer():
    return URLSafeSerializer(current_app.config["SECRET_KEY"], salt=COUNCIL_SIGN_SALT)


def build_council_sign_url(scope, registration):
    token = _serializer().dumps({"scope": scope, "registration_id": registration.id})
    return f"{request.host_url.rstrip('/')}/template/council-sign?t={token}"


def load_token(token):
    token = _clean_text(token)
    if not token:
        return None, (jsonify({"status": "error", "message": "缺少签名链接参数。"}), 400)
    try:
        payload = _serializer().loads(token)
    except BadSignature:
        return None, (jsonify({"status": "error", "message": "签名链接无效。"}), 400)
    return payload, None


def normalize_signature_strokes(value):
    """校验并规整前端传来的签名笔画 JSON：{ strokes: [{ points: [{x, y, t?}] }] }。"""
    if not isinstance(value, dict):
        return None
    strokes = value.get("strokes")
    if not isinstance(strokes, list) or not strokes:
        return None
    clean_strokes = []
    for stroke in strokes:
        points = (stroke or {}).get("points") if isinstance(stroke, dict) else None
        if not isinstance(points, list):
            continue
        clean_points = []
        for point in points:
            if not isinstance(point, dict):
                continue
            try:
                px = float(point.get("x"))
                py = float(point.get("y"))
            except (TypeError, ValueError):
                continue
            entry = {"x": px, "y": py}
            if point.get("t") is not None:
                try:
                    entry["t"] = int(point.get("t"))
                except (TypeError, ValueError):
                    pass
            clean_points.append(entry)
        if len(clean_points) >= 2:
            clean_strokes.append({"points": clean_points})
    if not clean_strokes:
        return None
    return {"strokes": clean_strokes}


def build_council_snapshot(user, method, signature=None):
    try:
        user_snapshot = user.to_dict()
    except Exception:
        user_snapshot = {
            "id": getattr(user, "id", None),
            "username": getattr(user, "username", None),
            "display_name": getattr(user, "display_name", None),
        }
    return {
        "method": method,
        "signed_at": datetime.utcnow().isoformat(),
        "signature": signature,
        "user_snapshot": user_snapshot,
    }


def extract_signature_payload(data):
    if not isinstance(data, dict):
        raise ValueError("请先手写签名再提交。")
    strokes = normalize_signature_strokes(data.get("signature"))
    if strokes is None:
        raise ValueError("请先手写签名再提交。")
    return strokes


def augment_serialized(scope, registration, data):
    """给 registration 序列化结果补上 viewer 字段与永久签名 URL。"""
    council = dict(data.get("council") or {})
    viewer = current_user if getattr(current_user, "is_authenticated", False) else None
    viewer_can_sign = False
    viewer_signed = False
    if viewer is not None:
        try:
            viewer_permissions = get_current_user_permissions(viewer)
        except Exception:
            viewer_permissions = set()
        viewer_can_sign = COUNCIL_PERMISSION in viewer_permissions
        viewer_signed = any(
            signature.get("user_id") == viewer.id for signature in council.get("signatures", [])
        )
    council["viewer_can_sign"] = viewer_can_sign
    council["viewer_signed"] = viewer_signed
    data["council"] = council
    data["council_sign_url"] = build_council_sign_url(scope, registration)
    return data


def _signature_query(cfg, registration_id, user_id):
    return cfg.signature_model.query.filter_by(
        **{cfg.fk_attr: registration_id, "user_id": user_id}
    )


def record_signature(cfg, registration, user, method, signature=None):
    """写入一条理事签名（含 user_data 快照 + 签名笔画）。返回 (signature_row, newly_signed)。

    生效后仍可继续补签，直到达到 scope 的上限。
    """
    existing = _signature_query(cfg, registration.id, user.id).first()
    if existing is not None:
        return existing, False

    if len(getattr(registration, cfg.signatures_attr) or []) >= cfg.max_signatures:
        raise ValueError(f"理事会签名已达上限（{cfg.max_signatures} 个），无法再签名。")

    signature_row = cfg.signature_model(
        user_id=user.id,
        data=build_council_snapshot(user, method, signature=signature),
    )
    getattr(registration, cfg.signatures_attr).append(signature_row)
    db.session.flush()
    return signature_row, True


def add_council_signature(scope, registration_id, data):
    """工作台内直接签名（当前登录用户）。"""
    cfg = get_scope(scope)
    if cfg is None:
        return jsonify({"status": "error", "message": "未知的签名类型。"}), 400
    registration = cfg.get_registration(registration_id)
    if not registration:
        return jsonify({"status": "error", "message": "记录不存在"}), 404

    try:
        signature = extract_signature_payload(data)
        _, newly_signed = record_signature(cfg, registration, current_user, "workbench", signature=signature)
        registration.sync_status_from_payment()
        activated_now = cfg.activate(registration)
        db.session.commit()

        if activated_now:
            message = "签名已记录，理事会审批已达标，注册日期已开始。"
        elif newly_signed:
            message = "已记录你的理事会签名（签名后不可撤回）。"
        else:
            message = "你之前已经签过名了。"
        return jsonify(
            {
                "status": "success",
                "message": message,
                "registration": cfg.serialize(registration),
            }
        )
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except IntegrityError:
        db.session.rollback()
        return jsonify({"status": "error", "message": "你之前已经签过名了。"}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500


def get_sign_mobile_context(token):
    payload, error = load_token(token)
    if error is not None:
        return error
    cfg = get_scope(payload.get("scope"))
    if cfg is None:
        return jsonify({"status": "error", "message": "签名链接无效。"}), 400
    registration = cfg.get_registration(payload.get("registration_id"))
    if not registration:
        return jsonify({"status": "error", "message": "签名链接对应的资料不存在。"}), 404

    signer = current_user
    try:
        signer_permissions = get_current_user_permissions(signer)
    except Exception:
        signer_permissions = set()
    can_sign = COUNCIL_PERMISSION in signer_permissions

    already_signed = _signature_query(cfg, registration.id, signer.id).first() is not None
    council = registration.to_dict().get("council") or {}
    signer_name = getattr(signer, "display_name", None) or getattr(signer, "username", None) or "本人"
    applicant_name = cfg.applicant_name(registration) or "该申请人"
    consent_text = f"我 {signer_name} 同意 {applicant_name} 加入{cfg.org_name}{cfg.consent_object}。"

    return jsonify(
        {
            "status": "success",
            "scope": cfg.scope,
            "org_name": cfg.org_name,
            "consent_object": cfg.consent_object,
            "applicant_name": applicant_name,
            "signer_name": signer_name,
            "consent_text": consent_text,
            "can_sign": can_sign,
            "already_signed": already_signed,
            "activated": registration.status == "paid",
            "full": bool(council.get("full")),
            "council": {
                "count": council.get("count", 0),
                "required": council.get("required"),
                "max": council.get("max"),
            },
        }
    )


def submit_sign_mobile(token, data):
    payload, error = load_token(token)
    if error is not None:
        return error
    cfg = get_scope(payload.get("scope"))
    if cfg is None:
        return jsonify({"status": "error", "message": "签名链接无效。"}), 400
    registration = cfg.get_registration(payload.get("registration_id"))
    if not registration:
        return jsonify({"status": "error", "message": "签名链接对应的资料不存在。"}), 404

    signer = current_user
    try:
        signer_permissions = get_current_user_permissions(signer)
    except Exception:
        signer_permissions = set()
    if COUNCIL_PERMISSION not in signer_permissions:
        return jsonify({"status": "error", "message": "你没有理事会审批（council_approve）权限，无法签名。"}), 403

    try:
        signature = extract_signature_payload(data)
        _, newly_signed = record_signature(cfg, registration, signer, "link", signature=signature)
        registration.sync_status_from_payment()
        cfg.activate(registration)
        db.session.commit()
        message = "签名已提交，感谢！" if newly_signed else "你之前已经签过名了。"
        return jsonify({"status": "success", "message": message, "already_signed": not newly_signed})
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 400
    except IntegrityError:
        db.session.rollback()
        return jsonify({"status": "success", "message": "你之前已经签过名了。", "already_signed": True})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(exc)}), 500
