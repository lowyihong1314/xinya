import os
import secrets
from datetime import datetime, timedelta

from PIL import Image
from flask import Blueprint, jsonify, request, send_file, session
from flask_login import current_user, login_required, login_user, logout_user

from app.auth import permission_required
from app.media.paths import DATA_PATH, to_short_data_path
from app.user_control.utils import PROFILE_PATH, generate_resized_image
from models import db
from models.user_data import Department, MemberRenewal, User

user_control_bp = Blueprint("user_control", __name__)

MEMBER_RENEWAL_ROOT = os.path.join(DATA_PATH, "NAS", "UTBA", "member_renewal")


@user_control_bp.get("/get_user_data")
@login_required
def get_user_data():
    return jsonify(current_user.to_dict())


@user_control_bp.post("/edit_reject_local/<edit_type>")
@permission_required("member_edit")
def edit_reject_local(edit_type):
    if edit_type not in ["approve", "reject"]:
        return jsonify({"error": "invalid edit_type"}), 400

    if edit_type == "approve":
        current_user.reject_local = True
        current_user.reject_date = datetime.utcnow()
    else:
        current_user.reject_local = False
        current_user.reject_date = None

    db.session.commit()
    return jsonify(
        {
            "id": current_user.id,
            "reject_local": current_user.reject_local,
            "reject_date": current_user.reject_date.isoformat()
            if current_user.reject_date
            else None,
        }
    )


@user_control_bp.get("/get_all_user_data")
def get_all_user_data():
    if current_user.is_authenticated:
        users = User.query.all()
        user_data = [user.to_dict() for user in users]
        login = True
    else:
        users = User.query.filter_by(display=True).all()
        user_data = [
            {
                "id": user.id,
                "username": user.username,
                "display_name": user.display_name,
            }
            for user in users
        ]
        login = False

    return jsonify({"login": login, "data": user_data})


@user_control_bp.get("/get_user_detail/<int:user_id>")
@login_required
def get_user_detail(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "用户不存在"}), 404
    return jsonify(user.to_dict())


@user_control_bp.post("/edit_user_data")
@permission_required("member_edit")
def edit_user_data():
    try:
        data = request.get_json() or {}
        target_user_id = data.get("user_id") or current_user.id
        user = User.query.get(target_user_id)
        if not user:
            return jsonify({"status": "error", "message": "用户不存在"}), 404

        for field in ["display_name", "email", "phone", "user_theme"]:
            if field in data:
                setattr(user, field, data[field])

        if "is_member" in data:
            user.is_member = bool(data.get("is_member"))

        db.session.commit()
        return jsonify({"status": "success", "message": "用户信息更新成功"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"更新失败: {str(exc)}"}), 500


@user_control_bp.post("/register")
@permission_required("member_edit")
def register():
    data = request.get_json() or {}
    username = data.get("username")
    password = data.get("password")
    phone = data.get("phone")
    email = data.get("email")

    if not username or not password or not email:
        return jsonify({"error": "username, password 和 email 都是必填的"}), 400

    if User.query.filter((User.username == username) | (User.email == email)).first():
        return jsonify({"error": "用户名或邮箱已存在"}), 409

    try:
        user = User(
            username=username,
            email=email,
            phone=phone,
            created_by=current_user.id,
        )
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        return jsonify({"success": True, "user": user.to_dict()}), 201
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error": f"注册失败: {str(exc)}"}), 500


@user_control_bp.get("/logout")
@login_required
def logout():
    logout_user()
    return jsonify({"status": "success"}), 200


@user_control_bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("username")
    password = data.get("password")

    if not username or not password:
        return jsonify({"error": "用户名和密码不能为空"}), 400

    user = User.query.filter_by(username=username).first()
    if user and user.check_password(password):
        login_user(user, remember=True, duration=timedelta(days=7))
        session["login_version"] = user.login_version
        return jsonify({"success": True})

    return jsonify({"error": "用户名或密码错误"}), 401


@user_control_bp.post("/change_password")
@login_required
def change_password():
    data = request.get_json() or {}
    old_password = data.get("old_password")
    new_password = data.get("new_password")

    if not old_password or not new_password:
        return jsonify({"status": "error", "message": "旧密码和新密码不能为空"}), 400
    if not current_user.check_password(old_password):
        return jsonify({"status": "error", "message": "旧密码错误"}), 403

    current_user.set_password(new_password)
    current_user.increment_login_version()
    db.session.commit()
    session["login_version"] = current_user.login_version
    return jsonify({"status": "success", "message": "密码修改成功"}), 200


@user_control_bp.get("/reset_password/<int:user_id>")
@permission_required("member_edit")
def reset_password(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "用户不存在"}), 404

    user.set_password("123456")
    user.increment_login_version()
    db.session.commit()
    return jsonify({"status": "success", "message": "密码已重置为 123456"}), 200


@user_control_bp.get("/departments")
def list_departments():
    return jsonify([department.to_dict() for department in Department.query.all()])


@user_control_bp.post("/departments")
@permission_required("department_edit")
def create_department():
    try:
        data = request.get_json() or {}
        name = data.get("name")
        if not name:
            return jsonify({"status": "error", "message": "部门名称不能为空"}), 400
        if Department.query.filter_by(name=name).first():
            return jsonify({"status": "error", "message": "部门已存在"}), 400

        department = Department(name=name)
        db.session.add(department)
        db.session.commit()
        return jsonify({"status": "success", "message": "部门创建成功", "id": department.id})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"创建失败: {str(exc)}"}), 500


@user_control_bp.delete("/departments/<int:dept_id>")
@permission_required("department_edit")
def delete_department(dept_id):
    try:
        if dept_id == 1:
            return jsonify({"status": "error", "message": "不能删除默认部门（1号群）"}), 403

        department = Department.query.get(dept_id)
        if not department:
            return jsonify({"status": "error", "message": "部门不存在"}), 404

        db.session.delete(department)
        db.session.commit()
        return jsonify({"status": "success", "message": "部门删除成功"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"删除失败: {str(exc)}"}), 500


@user_control_bp.post("/departments/<int:dept_id>/add_user")
@permission_required("department_edit")
def add_user_to_department(dept_id):
    try:
        data = request.get_json() or {}
        user = User.query.get(data.get("user_id"))
        department = Department.query.get(dept_id)
        if not user or not department:
            return jsonify({"status": "error", "message": "用户或部门不存在"}), 404
        if department in user.departments:
            return jsonify({"status": "error", "message": "用户已在该部门"}), 400

        user.departments.append(department)
        db.session.commit()
        return jsonify({"status": "success", "message": "用户加入部门成功"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"加入失败: {str(exc)}"}), 500


@user_control_bp.post("/departments/<int:dept_id>/remove_user")
@permission_required("department_edit")
def remove_user_from_department(dept_id):
    try:
        data = request.get_json() or {}
        user = User.query.get(data.get("user_id"))
        department = Department.query.get(dept_id)
        if not user or not department:
            return jsonify({"status": "error", "message": "用户或部门不存在"}), 404
        if user.id == 1 and department.id == 1:
            return jsonify({"status": "error", "message": "不能将系统管理员移出科技组"}), 403
        if department not in user.departments:
            return jsonify({"status": "error", "message": "用户不在该部门"}), 400

        user.departments.remove(department)
        db.session.commit()
        return jsonify({"status": "success", "message": "用户移出部门成功"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"移出失败: {str(exc)}"}), 500


def _save_member_renewal_proof(user, uploaded_file):
    if not uploaded_file or not getattr(uploaded_file, "filename", ""):
        return None

    raw_name = os.path.basename((uploaded_file.filename or "").strip())
    extension = os.path.splitext(raw_name)[1].lower()
    folder_name = user.username or f"user_{user.id}"
    target_dir = os.path.join(MEMBER_RENEWAL_ROOT, folder_name)
    os.makedirs(target_dir, exist_ok=True)

    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(4)}{extension}"
    target_path = os.path.join(target_dir, filename)
    uploaded_file.save(target_path)
    return {
        "proof_path": to_short_data_path(target_path),
        "proof_name": raw_name or filename,
        "proof_mime": uploaded_file.mimetype or None,
    }


@user_control_bp.get("/member_renewal/<int:user_id>")
@login_required
@permission_required("account_edit")
def get_member_renewals(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "用户不存在"}), 404
    return jsonify({"status": "success", "data": [item.to_dict() for item in user.member_renewals]})


@user_control_bp.post("/member_renewal/<int:user_id>")
@login_required
@permission_required("account_edit")
def create_member_renewal(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "用户不存在"}), 404

    try:
        renewal_date_raw = request.form.get("renewal_date") or request.values.get("renewal_date")
        if not renewal_date_raw:
            return jsonify({"status": "error", "message": "续费日期不能为空"}), 400
        renewal_date = datetime.strptime(renewal_date_raw, "%Y-%m-%d").date()
        upload = request.files.get("proof") or request.files.get("file")
        saved = _save_member_renewal_proof(user, upload) or {}

        record = MemberRenewal(
            user_id=user.id,
            renewal_date=renewal_date,
            note=(request.form.get("note") or request.values.get("note") or "").strip() or None,
            proof_path=saved.get("proof_path"),
            proof_name=saved.get("proof_name"),
            proof_mime=saved.get("proof_mime"),
            created_by=current_user.id,
        )
        db.session.add(record)
        db.session.commit()
        return jsonify({"status": "success", "message": "会员续费已保存", "data": record.to_dict()})
    except ValueError:
        db.session.rollback()
        return jsonify({"status": "error", "message": "续费日期格式无效"}), 400
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"保存失败: {str(exc)}"}), 500


@user_control_bp.delete("/member_renewal/<int:renewal_id>")
@login_required
@permission_required("account_edit")
def delete_member_renewal(renewal_id):
    record = MemberRenewal.query.get(renewal_id)
    if not record:
        return jsonify({"status": "error", "message": "续费记录不存在"}), 404
    proof_path = record.proof_path
    try:
        db.session.delete(record)
        db.session.commit()
        if proof_path:
            full_path = os.path.join(DATA_PATH, proof_path)
            if os.path.isfile(full_path):
                os.remove(full_path)
        return jsonify({"status": "success", "message": "续费记录已删除"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"删除失败: {str(exc)}"}), 500


@user_control_bp.delete("/delete_user/<int:user_id>")
@permission_required("member_edit")
def delete_user(user_id):
    if not any(department.id == 1 for department in current_user.departments):
        return jsonify({"status": "error", "message": "无权限删除用户"}), 403
    if user_id == 1:
        return jsonify({"status": "error", "message": "不能删除系统管理员用户"}), 403

    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "用户不存在"}), 404

    try:
        db.session.delete(user)
        db.session.commit()
        return jsonify({"status": "success", "message": "用户删除成功"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"删除失败: {str(exc)}"}), 500


@user_control_bp.get("/departments/<int:dept_id>/users")
def get_department_users(dept_id):
    department = Department.query.get(dept_id)
    if not department:
        return jsonify({"status": "error", "message": "部门不存在"}), 404

    if current_user.is_authenticated:
        users = department.users
        user_data = [user.to_dict() for user in users]
        login = True
    else:
        users = [user for user in department.users if user.display]
        user_data = [
            {
                "id": user.id,
                "username": user.username,
                "display_name": user.display_name,
            }
            for user in users
        ]
        login = False

    return jsonify(
        {
            "id": department.id,
            "name": department.name,
            "login": login,
            "users": user_data,
        }
    )


@user_control_bp.post("/upload_profile_image")
def upload_profile_image():
    if "image" not in request.files:
        return jsonify({"success": False, "error": "No file part"})

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"success": False, "error": "No selected file"})

    if file:
        img = Image.open(file.stream).convert("RGB")
        generate_resized_image(
            img,
            os.path.join(PROFILE_PATH, f"{current_user.username}_profile_image_s.jpg"),
            (600, 600),
            50,
        )
        generate_resized_image(
            img,
            os.path.join(PROFILE_PATH, f"{current_user.username}_profile_image.jpg"),
            (900, 900),
            80,
        )
        generate_resized_image(
            img,
            os.path.join(PROFILE_PATH, f"{current_user.username}_profile_image_l.jpg"),
            (1200, 1200),
            100,
        )
        return jsonify({"success": True})

    return jsonify({"success": False, "error": "File upload failed"})


@user_control_bp.route("/get_profile_image/<username>")
@user_control_bp.route("/get_profile_image/<username>/<size>")
def get_profile_image(username, size="M"):
    if username.isdigit():
        user = User.query.get(int(username))
        if user:
            username = user.username
        else:
            return send_file(os.path.join(PROFILE_PATH, "user.jpg"))

    if size == "S":
        image_path = os.path.join(PROFILE_PATH, f"{username}_profile_image_s.jpg")
    elif size == "M":
        image_path = os.path.join(PROFILE_PATH, f"{username}_profile_image.jpg")
    elif size == "L":
        image_path = os.path.join(PROFILE_PATH, f"{username}_profile_image_l.jpg")
    else:
        return jsonify({"success": False, "error": "Invalid size"}), 400

    if os.path.exists(image_path):
        return send_file(image_path)
    return send_file(os.path.join(PROFILE_PATH, "user.jpg"))


@user_control_bp.post("/update_user/<int:user_id>")
@permission_required("member_edit")
def update_user(user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({"status": "error", "message": "用户不存在"}), 404

    data = request.get_json() or {}
    try:
        for key, value in data.items():
            if hasattr(user, key):
                setattr(user, key, bool(value) if key in {"display", "is_member"} else value)

        db.session.commit()
        return jsonify({"status": "success", "message": "用户信息更新成功"})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"更新失败: {str(exc)}"}), 500
