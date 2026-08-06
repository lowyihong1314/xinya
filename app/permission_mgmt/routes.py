from flask import Blueprint, jsonify, request
from flask_login import login_required

from app.auth import permission_names as PERMISSION_CATALOG
from models.user_data import Department, DepartmentPermission, db

permission_bp = Blueprint("permission", __name__)


def _catalog_entry(name):
    return {"id": name, "name": name, "ref": name}


def _resolve_permission_name(data):
    """兼容旧字段名：permission_id 现在就是权限名字符串。"""
    raw = data.get("permission_name") or data.get("permission_id")
    name = str(raw or "").strip()
    return name if name in PERMISSION_CATALOG else None


@permission_bp.get("/get_all_permission")
@login_required
def get_all_permission():
    permissions = [_catalog_entry(name) for name in PERMISSION_CATALOG]
    return jsonify({"permissions": permissions, "count": len(permissions)}), 200


@permission_bp.post("/add_permission_to_department")
@login_required
def add_permission_to_department():
    data = request.get_json() or {}
    department = Department.query.get(data.get("department_id"))
    name = _resolve_permission_name(data)
    if not department or not name:
        return jsonify({"error": "Invalid department_id or permission_id"}), 400

    if any(p.name == name for p in department.permissions):
        return jsonify({"message": "Permission already assigned to department"}), 200

    department.permissions.append(DepartmentPermission(name=name))
    db.session.commit()
    return (
        jsonify({"message": f"Permission '{name}' added to Department '{department.name}' successfully."}),
        201,
    )


@permission_bp.post("/remove_permission_from_department")
@login_required
def remove_permission_from_department():
    data = request.get_json() or {}
    department = Department.query.get(data.get("department_id"))
    raw = str(data.get("permission_name") or data.get("permission_id") or "").strip()
    if not department or not raw:
        return jsonify({"error": "Invalid department_id or permission_id"}), 400

    target = next((p for p in department.permissions if p.name == raw), None)
    if target is None:
        return jsonify({"message": "Permission not found in department"}), 404

    department.permissions.remove(target)
    db.session.commit()
    return (
        jsonify({"message": f"Permission '{raw}' removed from Department '{department.name}' successfully."}),
        200,
    )
