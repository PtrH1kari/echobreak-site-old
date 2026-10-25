import jwt
import datetime
import hashlib
import os
from werkzeug.utils import secure_filename
from flask import Blueprint, request, jsonify
from db import get_db


SECRET = "1RBspDrvitiaK25LISTmgR6pRHDeUmnVNgoPR13kMzM"

auth = Blueprint("auth", __name__, url_prefix="/api")


# ==============================
# PASSWORD HASH
# ==============================

SALT = "szGWWJ2Id3IHC3JdoGDiwhAc"

def hash_password(password):
    return hashlib.sha256((password + SALT).encode()).hexdigest()


# ==============================
# JWT
# ==============================

def create_token(user):

    payload = {
        "id": user["id"],
        "username": user["username"],
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=30)
    }

    token = jwt.encode(payload, SECRET, algorithm="HS256")

    if isinstance(token, bytes):
        token = token.decode("utf-8")

    return token


def decode_token(token):
    try:
        return jwt.decode(token, SECRET, algorithms=["HS256"])
    except:
        return None


# ==============================
# REGISTER
# ==============================

@auth.route("/register", methods=["POST"])
def register():
    try:
        data = request.json

        if not data or "username" not in data or "password" not in data:
            return jsonify({"error": "Invalid data"}), 400

        username = data["username"]
        password = hash_password(data["password"])

        db = get_db()

        with db.cursor() as cur:

            # Проверка существования пользователя
            cur.execute(
                "SELECT id FROM users WHERE username=%s",
                (username,)
            )

            if cur.fetchone():
                return jsonify({"error": "User exists"}), 400

            # ВАЖНО: password_hash
            cur.execute(
                """INSERT INTO users(username, password_hash, role, avatar)
                   VALUES(%s, %s, 'user', '/static/images/avatar-placeholder.png')""",
                (username, password)
            )

            user_id = cur.lastrowid

            cur.execute(
                "SELECT * FROM users WHERE id=%s",
                (user_id,)
            )

            user = cur.fetchone()

        return jsonify({
            "token": create_token(user)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================
# LOGIN
# ==============================

@auth.route("/login", methods=["POST"])
def login():
    try:
        data = request.json

        if not data or "username" not in data or "password" not in data:
            return jsonify({"error": "Invalid data"}), 400

        username = data["username"]
        password = hash_password(data["password"])

        db = get_db()

        with db.cursor() as cur:

            # Сначала получаем пользователя
            cur.execute(
                "SELECT * FROM users WHERE username=%s",
                (username,)
            )

            user = cur.fetchone()

            if not user:
                return jsonify({"error": "Invalid login"}), 401

            # Проверяем hash
            if user["password_hash"] != password:
                return jsonify({"error": "Invalid login"}), 401

        return jsonify({
            "token": create_token(user)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==============================
# CHANGE PASSWORD
# ==============================

@auth.route("/change-password", methods=["POST"])
def change_password():
    """
    Allows a logged-in user to change their password.

    Required JSON:
    {
        "old_password": "...",
        "new_password": "..."
    }
    """

    # ==========================
    # VERIFY TOKEN
    # ==========================

    token = request.headers.get("Authorization")

    if not token:
        return jsonify({"error": "No token"}), 401

    token = token.replace("Bearer ", "")
    token_data = decode_token(token)

    if not token_data:
        return jsonify({"error": "Invalid token"}), 401

    # ==========================
    # VALIDATE INPUT
    # ==========================

    data = request.json

    if not data:
        return jsonify({"error": "Invalid request"}), 400

    old_password = data.get("old_password")
    new_password = data.get("new_password")

    if not old_password or not new_password:
        return jsonify({"error": "Missing password"}), 400

    if len(new_password) < 6:
        return jsonify({"error": "Password too short"}), 400

    try:

        db = get_db()

        with db.cursor() as cur:

            # Get user password hash
            cur.execute(
                "SELECT password_hash FROM users WHERE id=%s",
                (token_data["id"],)
            )

            user = cur.fetchone()

            if not user:
                return jsonify({"error": "User not found"}), 404

            # Verify old password
            if user["password_hash"] != hash_password(old_password):
                return jsonify({"error": "Wrong old password"}), 401

            # Update password
            cur.execute(
                "UPDATE users SET password_hash=%s WHERE id=%s",
                (hash_password(new_password), token_data["id"])
            )

        return jsonify({"success": True})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==============================
# ME
# ==============================

@auth.route("/me")
def me():

    token = request.headers.get("Authorization")

    if not token:
        return jsonify({"error": "No token"}), 401

    token = token.replace("Bearer ", "")

    data = decode_token(token)

    if not data:
        return jsonify({"error": "Invalid token"}), 401

    db = get_db()

    with db.cursor() as cur:
        cur.execute(
            "SELECT id, username, role, avatar, activation_key FROM users WHERE id=%s",
            (data["id"],)
        )

        user = cur.fetchone()

    return jsonify(user)


# ==============================
# AVATAR UPLOAD
# ==============================

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
UPLOAD_FOLDER = os.path.join(os.getcwd(), "static", "uploads", "avatars")

def allowed_file(filename):
    """Check if the file extension is allowed."""
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


@auth.route("/upload-avatar", methods=["POST"])
def upload_avatar():
    # Verify the JWT token from Authorization header
    token = request.headers.get("Authorization")

    if not token:
        return jsonify({"error": "No token"}), 401

    token = token.replace("Bearer ", "")
    data = decode_token(token)

    if not data:
        return jsonify({"error": "Invalid token"}), 401

    # Check that a file was actually sent
    if "avatar" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["avatar"]

    # Empty filename means no file was selected
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "File type not allowed. Use PNG, JPG, GIF or WEBP"}), 400

    # Limit file size to 5MB (bytes are read into memory by Flask already,
    # but we check content_length as an early guard)
    if request.content_length and request.content_length > 5 * 1024 * 1024:
        return jsonify({"error": "File too large. Maximum size is 5MB"}), 413

    try:
        # ==========================
        # DELETE OLD AVATAR FILE
        # ==========================

        try:

            for old_file in os.listdir(UPLOAD_FOLDER):

                if old_file.startswith(f"avatar_{data['id']}"):
                    old_path = os.path.join(UPLOAD_FOLDER, old_file)

                    if os.path.isfile(old_path):
                        os.remove(old_path)

        except Exception:
            # Failure to delete old avatar should NOT break upload
            pass


        # ==========================
        # SAVE NEW AVATAR
        # ==========================

        ext = file.filename.rsplit(".", 1)[1].lower()
        filename = f"avatar_{data['id']}.{ext}"
        safe_filename = secure_filename(filename)

        # Make sure the upload directory exists
        os.makedirs(UPLOAD_FOLDER, exist_ok=True)

        save_path = os.path.join(UPLOAD_FOLDER, safe_filename)
        file.save(save_path)

        # URL path served by Flask's static handler
        avatar_url = f"/static/uploads/avatars/{safe_filename}"

        # Persist the new avatar URL in the database
        db = get_db()
        with db.cursor() as cur:
            cur.execute(
                "UPDATE users SET avatar=%s WHERE id=%s",
                (avatar_url, data["id"])
            )

        return jsonify({"avatar": avatar_url})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ==============================
# ACTIVATION KEY
# ==============================

@auth.route("/activate-key", methods=["POST"])
def activate_key():
    # Verify JWT
    token = request.headers.get("Authorization")

    if not token:
        return jsonify({"error": "No token"}), 401

    token = token.replace("Bearer ", "")
    token_data = decode_token(token)

    if not token_data:
        return jsonify({"error": "Invalid token"}), 401

    data = request.json

    if not data or "key" not in data:
        return jsonify({"error": "No key provided"}), 400

    key = data["key"].strip()

    if not key:
        return jsonify({"error": "Key cannot be empty"}), 400

    user_id = token_data["id"]

    try:
        db = get_db()

        with db.cursor() as cur:

            # Check the user hasn't already activated a key
            cur.execute(
                "SELECT activation_key FROM users WHERE id=%s",
                (user_id,)
            )
            user = cur.fetchone()

            if user and user["activation_key"]:
                return jsonify({"error": "Вы уже активировали ключ"}), 400

            # Check the key exists and is not yet claimed by anyone
            cur.execute(
                "SELECT id, is_used FROM activation_keys WHERE key_value=%s",
                (key,)
            )
            row = cur.fetchone()

            if not row:
                return jsonify({"error": "Ключ не найден"}), 404

            if row["is_used"]:
                return jsonify({"error": "Ключ уже использован"}), 400

            # Claim the key — mark it used and link it to this user
            cur.execute(
                """UPDATE activation_keys
                   SET is_used=1, used_by=%s, used_at=NOW()
                   WHERE id=%s""",
                (user_id, row["id"])
            )

            # Store the key on the user record as well
            cur.execute(
                "UPDATE users SET activation_key=%s WHERE id=%s",
                (key, user_id)
            )

        return jsonify({"success": True, "key": key})

    except Exception as e:
        return jsonify({"error": str(e)}), 500