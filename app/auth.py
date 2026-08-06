from functools import wraps

from flask import jsonify
from flask_login import current_user

from app.extensions import login_manager
from models import db
from models.user_data import User

CHANGYOU_ROOM_CONTROL_PERMISSION = "changyou_contorl"

permission_names = [
    "department",
    "department_edit",
    "account_submit_claim",
    "account_submit_income",
    "account_read",
    "account_edit",
    "asset_read",
    "asset_edit",
    "member",
    "member_edit",
    "form_read",
    "form_edit",
    "member_detail",
    "youth_class_read",
    "youth_class_edit",
    "fahui_read",
    "event_edit",
    "permission",
    "permission_edit",
    "music_edit",
    "edit_info",
    "info_tree_hole",
    "council_approve",
    "cctv",
    CHANGYOU_ROOM_CONTROL_PERMISSION,
]

# 每个权限的用途说明（与 permission_names 一起维护，权限管理界面展示用）。
permission_descriptions = {
    "department": "查看部门与成员名单（用户管理的只读入口）",
    "department_edit": "创建/重命名/删除部门，调整部门成员",
    "account_submit_claim": "提交报销申请（活动预算页的「新建报销」也需要）",
    "account_submit_income": "提交收入记录（手动收款 / 销售收入）",
    "account_read": "查看财政数据：收款审核、报销列表、报表导出；也附带法会数据的查看权",
    "account_edit": "财政管理最高权限：审批收款与报销、管理法会/点灯/开放时间/费率等全部财政操作",
    "asset_read": "查看资产与库存数据",
    "asset_edit": "管理资产与库存（出入库单据、盘点）",
    "member": "查看会员申请工作台与会员名册（只读）",
    "member_edit": "审核会员申请、修改申请资料、管理会员续费记录",
    "form_read": "查看活动报名表与报名成员数据（只读）",
    "form_edit": "管理活动报名表：建表、改成员、配置报名费",
    "member_detail": "查看成员的完整个人资料（含 NRIC 等敏感字段）",
    "youth_class_read": "查看青少年佛学班报名数据（只读）",
    "youth_class_edit": "审核/管理青少年佛学班报名，含升级为会员",
    "fahui_read": "查看法会数据：牌位订单、点灯登记、看板、牌位打印/PDF",
    "event_edit": "管理活动：创建活动、流程、任务、财政预算",
    "permission": "查看权限配置（只读）",
    "permission_edit": "管理部门权限分配",
    "music_edit": "管理音乐内容：专辑、歌曲、唱诵资料",
    "edit_info": "编辑「简介/历史」公开页面内容",
    "info_tree_hole": "管理树洞留言（查看/删除）",
    "council_approve": "理事会签名：为会员/青少年班申请签名审批，附带相关工作台查看权",
    "cctv": "查看/控制 CCTV 监控：直播、录像回放、云台控制（nginx 网关鉴权）",
    CHANGYOU_ROOM_CONTROL_PERMISSION: "唱游房间控制：投影、点歌与房间管理",
}


@login_manager.unauthorized_handler
def unauthorized():
    return jsonify({"status": "error", "message": "unauthorized"}), 401


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


@login_manager.request_loader
def load_user_from_request(flask_request):
    header = (flask_request.headers.get("Authorization") or "").strip()
    if not header.lower().startswith("bearer "):
        return None

    access_token = header[7:].strip()
    if not access_token:
        return None

    try:
        from app.mobile.session_service import load_user_from_access_token

        return load_user_from_access_token(access_token)
    except Exception as exc:
        print(f"[移动端登录] Bearer token 验证失败: {exc}")
        return None


def get_current_user_permissions(user):
    permissions = set()
    for dept in getattr(user, "departments", []):
        for perm in getattr(dept, "permissions", []):
            permissions.add(perm.name)
    return permissions


def ensure_known_permissions():
    # 权限清单已完全代码化（permission_names），不再需要写入数据库。
    return []


def permission_required(permission_name):
    def decorator(func):
        @wraps(func)
        def decorated_function(*args, **kwargs):
            if not current_user.is_authenticated:
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": "无法验证用户权限，请联系管理员。",
                        }
                    ),
                    500,
                )

            try:
                user_permissions = get_current_user_permissions(current_user)
            except Exception as exc:
                print(f"[权限错误] 读取权限失败: {exc}")
                return (
                    jsonify(
                        {
                            "status": "error",
                            "message": "无法验证用户权限，请联系管理员。",
                        }
                    ),
                    500,
                )

            if permission_name not in user_permissions:
                username = current_user.username or "未知用户"
                message = f"用户 {username} 没有权限: {permission_name}"
                print("[权限拒绝]", message)
                return jsonify({"status": "error", "message": message}), 403

            return func(*args, **kwargs)

        return decorated_function

    return decorator
