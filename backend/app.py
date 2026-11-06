import json
import os
import re
from functools import wraps
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

from database import get_connection, initialize_database


ROOT = Path(__file__).resolve().parent.parent
SUPER_ADMIN_EMAIL = "mwendwafreddie@gmail.com"
COLLECTIONS = {
    "schedules",
    "jumuiyas",
    "ministries",
    "projects",
    "events",
}
app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY") or os.urandom(32),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get(
        "COOKIE_SECURE", "true" if os.environ.get("VERCEL") else ""
    ).lower() == "true",
    PERMANENT_SESSION_LIFETIME=60 * 60 * 8,
    MAX_CONTENT_LENGTH=1_000_000,
)
initialize_database()
if os.environ.get("VERCEL") and not os.environ.get("SECRET_KEY"):
    raise RuntimeError("SECRET_KEY must be configured for the Vercel deployment.")


def json_error(message, status=400):
    return jsonify({"error": message}), status


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    with get_connection() as connection:
        user = connection.execute(
            "SELECT id, email, name, role, enabled, jumuiya, ministry, scope_type, scope_name "
            "FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if not user or not user["enabled"]:
        session.clear()
        return None
    return dict(user)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if not user:
            return json_error("Sign in is required.", 401)
        return view(user, *args, **kwargs)

    return wrapped


def admin_required(super_admin_only=False):
    def decorate(view):
        @wraps(view)
        @login_required
        def wrapped(user, *args, **kwargs):
            is_super = user["email"].lower() == SUPER_ADMIN_EMAIL
            if super_admin_only and not is_super:
                return json_error("Only the Super Admin can perform this action.", 403)
            if not is_super and user["role"] not in ("administrator",):
                return json_error("Administrator access is required.", 403)
            return view(user, *args, **kwargs)

        return wrapped

    return decorate


def parse_json_field(value):
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return value


def valid_text(value, field, limit=500):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ValueError(f"{field} is required and must be under {limit} characters.")
    return value.strip()


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/api/auth/register")
def register():
    body = request.get_json(silent=True) or {}
    try:
        name = valid_text(body.get("name"), "Name", 120)
        email = valid_text(body.get("email"), "Email", 254).lower()
        password = body.get("password", "")
        jumuiya = body.get("jumuiya") or None
        if jumuiya and jumuiya not in {f"Jumuiya {index}" for index in range(1, 10)}:
            return json_error("Select a valid Jumuiya.")
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            return json_error("Enter a valid email address.")
        if not isinstance(password, str) or len(password) < 10:
            return json_error("Password must contain at least 10 characters.")
        if email == SUPER_ADMIN_EMAIL:
            return json_error(
                "The Super Admin account must be created with the secure bootstrap command.",
                403,
            )
        with get_connection() as connection:
            cursor = connection.execute(
                "INSERT INTO users (email, name, password_hash, role, jumuiya) "
                "VALUES (?, ?, ?, 'member', ?) RETURNING id",
                (email, name, generate_password_hash(password), jumuiya),
            )
            user_id = cursor.fetchone()["id"]
        session.clear()
        session["user_id"] = user_id
        session.permanent = True
        return jsonify({"user": current_user()}), 201
    except ValueError as error:
        return json_error(str(error))
    except Exception as error:
        if "UNIQUE constraint failed" in str(error) or "duplicate key value" in str(error):
            return json_error("An account with this email already exists.", 409)
        app.logger.exception("Account registration failed")
        return json_error("Could not create the account.", 500)


@app.post("/api/auth/login")
def login():
    body = request.get_json(silent=True) or {}
    email = str(body.get("email", "")).strip().lower()
    password = body.get("password", "")
    with get_connection() as connection:
        user = connection.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return json_error("Email or password is incorrect.", 401)
    if not user["enabled"]:
        return json_error("This account has been disabled. Contact the parish administrator.", 403)
    session.clear()
    session["user_id"] = user["id"]
    session.permanent = True
    return jsonify({"user": current_user()})


@app.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/auth/me")
def me():
    user = current_user()
    return jsonify({"user": user})


@app.get("/api/public")
def public_data():
    with get_connection() as connection:
        items = connection.execute(
            "SELECT collection, id, data FROM parish_content ORDER BY id"
        ).fetchall()
        settings = connection.execute("SELECT key, value FROM settings").fetchall()
    public = {collection: [] for collection in COLLECTIONS}
    for row in items:
        if row["collection"] in public:
            entry = parse_json_field(row["data"])
            if isinstance(entry, dict):
                entry["id"] = row["id"]
                public[row["collection"]].append(entry)
    setting_values = {row["key"]: row["value"] for row in settings}
    setting_values["payment"] = parse_json_field(setting_values.get("payment", "{}"))
    return jsonify({"content": public, "settings": setting_values})


def moderator_can_access(user, collection, data=None):
    if user["email"].lower() == SUPER_ADMIN_EMAIL or user["role"] == "administrator":
        return True
    if user["role"] != "moderator" or not data:
        return False
    expected_scope = "ministry" if collection == "ministries" else "jumuiya"
    return collection in ("ministries", "jumuiyas") and (
        user.get("scope_type") == expected_scope
        and data.get("name") == user.get("scope_name")
    )


@app.route("/api/content/<collection>", methods=["GET", "POST"])
@login_required
def content_collection(user, collection):
    if collection not in COLLECTIONS:
        return json_error("Unknown content collection.", 404)
    if request.method == "GET":
        with get_connection() as connection:
            rows = connection.execute(
                "SELECT id, data FROM parish_content WHERE collection = ? ORDER BY id",
                (collection,),
            ).fetchall()
        entries = []
        for row in rows:
            data = parse_json_field(row["data"])
            if moderator_can_access(user, collection, data):
                entries.append({"id": row["id"], **data})
        return jsonify({"items": entries})
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return json_error("A JSON object is required.")
    if not moderator_can_access(user, collection, data):
        return json_error("You do not have access to this ministry or Jumuiya.", 403)
    if user["role"] not in ("administrator", "super_admin", "moderator") and user["email"] != SUPER_ADMIN_EMAIL:
        return json_error("Administrator access is required.", 403)
    with get_connection() as connection:
        cursor = connection.execute(
            "INSERT INTO parish_content (collection, data) VALUES (?, ?) RETURNING id",
            (collection, json.dumps(data, ensure_ascii=False)),
        )
        item_id = cursor.fetchone()["id"]
    return jsonify({"id": item_id, **data}), 201


@app.route("/api/content/<collection>/<int:item_id>", methods=["PUT", "DELETE"])
@login_required
def update_content(user, collection, item_id):
    if collection not in COLLECTIONS:
        return json_error("Unknown content collection.", 404)
    with get_connection() as connection:
        row = connection.execute(
            "SELECT data FROM parish_content WHERE collection = ? AND id = ?",
            (collection, item_id),
        ).fetchone()
        if not row:
            return json_error("Item not found.", 404)
        existing = parse_json_field(row["data"])
        if not moderator_can_access(user, collection, existing):
            return json_error("You do not have access to this item.", 403)
        if request.method == "DELETE":
            if user["role"] not in ("administrator", "super_admin", "moderator") and user["email"] != SUPER_ADMIN_EMAIL:
                return json_error("Administrator access is required.", 403)
            connection.execute(
                "DELETE FROM parish_content WHERE collection = ? AND id = ?",
                (collection, item_id),
            )
            return jsonify({"ok": True})
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return json_error("A JSON object is required.")
        if not moderator_can_access(user, collection, data):
            return json_error("You do not have access to this ministry or Jumuiya.", 403)
        if user["role"] not in ("administrator", "super_admin", "moderator") and user["email"] != SUPER_ADMIN_EMAIL:
            return json_error("Administrator access is required.", 403)
        connection.execute(
            "UPDATE parish_content SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE collection = ? AND id = ?",
            (json.dumps(data, ensure_ascii=False), collection, item_id),
        )
    return jsonify({"id": item_id, **data})


@app.route("/api/settings", methods=["GET", "PUT"])
def parish_settings():
    if request.method == "GET":
        with get_connection() as connection:
            rows = connection.execute("SELECT key, value FROM settings").fetchall()
        return jsonify({row["key"]: parse_json_field(row["value"]) for row in rows})
    user = current_user()
    if not user or (user["role"] not in ("administrator", "super_admin") and user["email"] != SUPER_ADMIN_EMAIL):
        return json_error("Administrator access is required.", 403)
    updates = request.get_json(silent=True)
    if not isinstance(updates, dict):
        return json_error("A JSON object is required.")
    allowed = {"announcement", "payment", "map_embed", "address", "manual_readings", "show_schedules"}
    if set(updates) - allowed:
        return json_error("One or more setting keys are not allowed.")
    with get_connection() as connection:
        for key, value in updates.items():
            connection.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
                (key, json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list, bool)) else str(value)),
            )
    return jsonify({"ok": True})


@app.route("/api/moderator-requests", methods=["GET", "POST"])
@login_required
def moderator_requests(user):
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        scope_type = body.get("scope_type")
        if scope_type not in ("ministry", "jumuiya"):
            return json_error("Select a ministry or Jumuiya.")
        try:
            scope_name = valid_text(body.get("scope_name"), "Scope", 120)
            reason = str(body.get("reason", "")).strip()[:1000]
        except ValueError as error:
            return json_error(str(error))
        with get_connection() as connection:
            pending = connection.execute(
                "SELECT 1 FROM moderator_requests WHERE user_id = ? AND status = 'pending'",
                (user["id"],),
            ).fetchone()
            if pending:
                return json_error("You already have a pending moderator request.", 409)
            cursor = connection.execute(
                "INSERT INTO moderator_requests (user_id, scope_type, scope_name, reason) "
                "VALUES (?, ?, ?, ?) RETURNING id",
                (user["id"], scope_type, scope_name, reason),
            )
            request_id = cursor.fetchone()["id"]
        return jsonify({"id": request_id, "status": "pending"}), 201
    with get_connection() as connection:
        if user["email"].lower() == SUPER_ADMIN_EMAIL or user["role"] == "administrator":
            rows = connection.execute(
                "SELECT r.*, u.name, u.email FROM moderator_requests r "
                "JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC"
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT r.*, u.name, u.email FROM moderator_requests r "
                "JOIN users u ON u.id = r.user_id WHERE r.user_id = ? ORDER BY r.created_at DESC",
                (user["id"],),
            ).fetchall()
    return jsonify({"items": [dict(row) for row in rows]})


@app.route("/api/moderator-requests/<int:request_id>", methods=["PATCH", "DELETE"])
@admin_required()
def review_moderator_request(user, request_id):
    body = request.get_json(silent=True) or {}
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM moderator_requests WHERE id = ?", (request_id,)
        ).fetchone()
        if not row:
            return json_error("Moderator request not found.", 404)
        is_super = user["email"].lower() == SUPER_ADMIN_EMAIL
        if request.method == "DELETE":
            if row["status"] == "approved":
                connection.execute(
                    "UPDATE users SET role = 'member', ministry = NULL, scope_type = NULL, "
                    "scope_name = NULL WHERE id = ? AND email != ?",
                    (row["user_id"], SUPER_ADMIN_EMAIL),
                )
            connection.execute("DELETE FROM moderator_requests WHERE id = ?", (request_id,))
            return jsonify({"ok": True})
        status = body.get("status")
        if status not in ("approved", "rejected"):
            return json_error("Status must be approved or rejected.")
        if row["status"] == "approved" and not is_super:
            return json_error("Only the Super Admin can alter an approved moderator request.", 403)
        if status == "approved":
            connection.execute(
                "UPDATE users SET role = 'moderator', scope_type = ?, scope_name = ?, "
                "ministry = CASE WHEN ? = 'ministry' THEN ? ELSE NULL END WHERE id = ?",
                (
                    row["scope_type"],
                    row["scope_name"],
                    row["scope_type"],
                    row["scope_name"],
                    row["user_id"],
                ),
            )
        elif row["status"] == "approved":
            connection.execute(
                "UPDATE users SET role = 'member', ministry = NULL, "
                "scope_type = NULL, scope_name = NULL WHERE id = ?",
                (row["user_id"],),
            )
        connection.execute(
            "UPDATE moderator_requests SET status = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, request_id),
        )
    return jsonify({"ok": True, "status": status})


@app.get("/api/users")
@admin_required(super_admin_only=True)
def list_users(user):
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT id, email, name, role, enabled, jumuiya, ministry, scope_type, scope_name, "
            "created_at FROM users ORDER BY created_at DESC"
        ).fetchall()
    return jsonify({"items": [dict(row) for row in rows]})


@app.patch("/api/users/<int:user_id>")
@admin_required(super_admin_only=True)
def update_user(user, user_id):
    body = request.get_json(silent=True) or {}
    with get_connection() as connection:
        target = connection.execute(
            "SELECT email, role FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if not target:
            return json_error("User not found.", 404)
        if target["email"].lower() == SUPER_ADMIN_EMAIL:
            return json_error("The Super Admin account cannot be changed.", 403)
        if "enabled" in body:
            if not isinstance(body["enabled"], bool):
                return json_error("enabled must be true or false.")
            connection.execute(
                "UPDATE users SET enabled = ? WHERE id = ?",
                (int(body["enabled"]), user_id),
            )
        if "role" in body:
            if body["role"] not in ("member", "administrator"):
                return json_error("Only member and administrator roles can be assigned here.")
            connection.execute("UPDATE users SET role = ? WHERE id = ?", (body["role"], user_id))
    return jsonify({"ok": True})


@app.delete("/api/users/<int:user_id>")
@admin_required(super_admin_only=True)
def delete_user(user, user_id):
    with get_connection() as connection:
        target = connection.execute(
            "SELECT email FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if not target:
            return json_error("User not found.", 404)
        if target["email"].lower() == SUPER_ADMIN_EMAIL:
            return json_error("The Super Admin account cannot be deleted.", 403)
        connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return jsonify({"ok": True})


@app.route("/api/donations", methods=["GET", "POST"])
@login_required
def donations(user):
    with get_connection() as connection:
        if request.method == "GET":
            if user["email"].lower() == SUPER_ADMIN_EMAIL or user["role"] == "administrator":
                rows = connection.execute(
                    "SELECT d.*, u.name, u.email FROM donations d LEFT JOIN users u ON u.id = d.user_id ORDER BY d.created_at DESC"
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM donations WHERE user_id = ? ORDER BY created_at DESC",
                    (user["id"],),
                ).fetchall()
            return jsonify({"items": [dict(row) for row in rows]})
        body = request.get_json(silent=True) or {}
        try:
            amount = float(body.get("amount"))
            if amount <= 0 or amount > 100_000_000:
                raise ValueError()
        except (ValueError, TypeError):
            return json_error("Enter a valid contribution amount.")
        with get_connection() as connection:
            cursor = connection.execute(
                "INSERT INTO donations (user_id, jumuiya, amount, project, reference) "
                "VALUES (?, ?, ?, ?, ?) RETURNING id",
                (user["id"], user.get("jumuiya"), amount, str(body.get("project", ""))[:120], str(body.get("reference", ""))[:120]),
            )
            donation_id = cursor.fetchone()["id"]
        return jsonify({"id": donation_id, "status": "pledged"}), 201


@app.patch("/api/donations/<int:donation_id>")
@admin_required()
def confirm_donation(user, donation_id):
    with get_connection() as connection:
        cursor = connection.execute(
            "UPDATE donations SET status = 'confirmed' WHERE id = ?", (donation_id,)
        )
    if cursor.rowcount == 0:
        return json_error("Contribution not found.", 404)
    return jsonify({"ok": True})


@app.route("/api/sacramental-requests", methods=["GET", "POST"])
@login_required
def sacramental_requests(user):
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        sacrament = str(body.get("sacrament", "")).strip()
        if sacrament not in ("Baptism", "First Communion", "Confirmation", "Matrimony", "Certificate"):
            return json_error("Select a valid request type.")
        try:
            applicant_name = valid_text(body.get("applicant_name"), "Applicant name", 120)
            contact = valid_text(body.get("contact"), "Contact", 120)
            details = str(body.get("details", "")).strip()[:2000]
        except ValueError as error:
            return json_error(str(error))
        with get_connection() as connection:
            cursor = connection.execute(
                "INSERT INTO sacramental_requests (user_id, sacrament, applicant_name, contact, details) "
                "VALUES (?, ?, ?, ?, ?) RETURNING id",
                (user["id"], sacrament, applicant_name, contact, details),
            )
            request_id = cursor.fetchone()["id"]
        return jsonify({"id": request_id, "status": "pending"}), 201
    with get_connection() as connection:
        if user["email"].lower() == SUPER_ADMIN_EMAIL or user["role"] == "administrator":
            rows = connection.execute(
                "SELECT s.*, u.email FROM sacramental_requests s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC"
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM sacramental_requests WHERE user_id = ? ORDER BY created_at DESC",
                (user["id"],),
            ).fetchall()
    return jsonify({"items": [dict(row) for row in rows]})


@app.patch("/api/sacramental-requests/<int:request_id>")
@admin_required()
def update_sacramental_request(user, request_id):
    status = (request.get_json(silent=True) or {}).get("status")
    if status not in ("approved", "rejected"):
        return json_error("Status must be approved or rejected.")
    with get_connection() as connection:
        cursor = connection.execute(
            "UPDATE sacramental_requests SET status = ? WHERE id = ?",
            (status, request_id),
        )
    if cursor.rowcount == 0:
        return json_error("Request not found.", 404)
    return jsonify({"ok": True})


@app.post("/api/contact")
def contact():
    body = request.get_json(silent=True) or {}
    try:
        name = valid_text(body.get("name"), "Name", 120)
        email = valid_text(body.get("email"), "Email", 254)
        message = valid_text(body.get("message"), "Message", 3000)
    except ValueError as error:
        return json_error(str(error))
    with get_connection() as connection:
        connection.execute(
            "INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)",
            (name, email, message),
        )
    return jsonify({"ok": True}), 201


@app.get("/api/admin/messages")
@admin_required()
def messages(user):
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT id, name, email, message, created_at FROM contact_messages ORDER BY created_at DESC"
        ).fetchall()
    return jsonify({"items": [dict(row) for row in rows]})


@app.get("/")
def home():
    return send_from_directory(ROOT, "index.html")


@app.get("/admin")
@app.get("/admin/")
def admin_home():
    return send_from_directory(ROOT / "admin", "login.html")


if __name__ == "__main__":
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("FLASK_DEBUG", "").lower() == "true",
    )
