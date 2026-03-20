from flask import Blueprint, jsonify, request
from flask_login import login_required

from models.user_data import Department, Permission, db

permission_bp = Blueprint("permission", __name__)


@permission_bp.get("/get_all_permission")
@login_required
def get_all_permission():
    permissions = Permission.query.all()
    return jsonify(
        {"permissions": [permission.to_dict() for permission in permissions], "count": len(permissions)}
    ), 200


@permission_bp.post("/add_permission_to_department")
@login_required
def add_permission_to_department():
    data = request.get_json() or {}
    department_id = data.get("department_id")
    permission_id = data.get("permission_id")

    department = Department.query.get(department_id)
    permission = Permission.query.get(permission_id)
    if not department or not permission:
        return jsonify({"error": "Invalid department_id or permission_id"}), 400

    if permission in department.permissions:
        return jsonify({"message": "Permission already assigned to department"}), 200

    department.permissions.append(permission)
    db.session.commit()
    return (
        jsonify(
            {
                "message": (
                    f"Permission '{permission.name}' added to Department '{department.name}' successfully."
                )
            }
        ),
        201,
    )


@permission_bp.post("/remove_permission_from_department")
@login_required
def remove_permission_from_department():
    data = request.get_json() or {}
    department_id = data.get("department_id")
    permission_id = data.get("permission_id")

    department = Department.query.get(department_id)
    permission = Permission.query.get(permission_id)
    if not department or not permission:
        return jsonify({"error": "Invalid department_id or permission_id"}), 400

    if permission not in department.permissions:
        return jsonify({"message": "Permission not found in department"}), 404

    department.permissions.remove(permission)
    db.session.commit()
    return (
        jsonify(
            {
                "message": (
                    f"Permission '{permission.name}' removed from Department '{department.name}' successfully."
                )
            }
        ),
        200,
    )
