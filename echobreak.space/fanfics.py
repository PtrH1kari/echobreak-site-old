import os
from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename
from db import get_db
from auth import decode_token          # reuse existing JWT decoder — no circular import

fanfics_bp = Blueprint("fanfics", __name__, url_prefix="/api")

# ─── Config ────────────────────────────────────────────────────────────────────

FANFIC_COVER_FOLDER  = os.path.join(os.getcwd(), "static", "uploads", "fanfics")
ALLOWED_IMG_EXT      = {"png", "jpg", "jpeg", "gif", "webp"}
MAX_COVER_SIZE_BYTES = 5 * 1024 * 1024    # 5 MB hard limit for cover images


# ─── Private helpers ───────────────────────────────────────────────────────────

def _get_user(req):
    """
    Decode the JWT from the Authorization header.
    Returns the token payload dict on success, or None if missing/invalid.
    """
    raw   = req.headers.get("Authorization", "")
    token = raw.replace("Bearer ", "").strip()
    return decode_token(token) if token else None


def _allowed_cover(filename: str) -> bool:
    """Return True when the file extension is in the allowed set."""
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMG_EXT
    )


def _fanfic_stats(cur, fanfic_id: int) -> dict:
    """
    Run a single aggregating query and return total_views + unique_views.
    Called inside an already-open cursor context.
    """
    cur.execute(
        """
        SELECT
            COUNT(*)               AS total_views,
            COUNT(DISTINCT user_id) AS unique_views
        FROM fanfic_view_log
        WHERE fanfic_id = %s
        """,
        (fanfic_id,)
    )
    row = cur.fetchone()
    return {
        "total_views":  row["total_views"]  if row else 0,
        "unique_views": row["unique_views"] if row else 0,
    }


def _check_fanfic_access(user_id: int, db) -> bool:
    """
    Return True when the user has a valid activation_key (i.e. granted fanfic access).
    """
    with db.cursor() as cur:
        cur.execute(
            "SELECT activation_key FROM users WHERE id = %s",
            (user_id,)
        )
        row = cur.fetchone()
    return bool(row and row.get("activation_key"))


# ─── GET /api/fanfics  — list all fanfics ──────────────────────────────────────

@fanfics_bp.route("/fanfics", methods=["GET"])
def list_fanfics():
    user = _get_user(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db  = get_db()
    uid = user["id"]

    try:
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT
                    f.id,
                    f.title,
                    f.author_id,
                    u.username                                          AS author_name,
                    f.cover_url,
                    f.nsfw,
                    f.created_at,
                    COUNT(fvl.id)                                       AS total_views,
                    COUNT(DISTINCT fvl.user_id)                         AS unique_views,
                    COUNT(DISTINCT fs.user_id)                          AS star_count,
                    COALESCE(
                        MAX(CASE WHEN fs.user_id = %s THEN 1 ELSE 0 END),
                        0
                    )                                                   AS is_starred
                FROM fanfics f
                JOIN  users              u   ON  u.id  = f.author_id
                LEFT JOIN fanfic_view_log fvl ON fvl.fanfic_id = f.id
                LEFT JOIN fanfic_stars    fs  ON  fs.fanfic_id = f.id
                GROUP BY
                    f.id, f.title, f.author_id, u.username,
                    f.cover_url, f.nsfw, f.created_at
                ORDER BY f.created_at DESC
                """,
                (uid,)
            )
            rows = cur.fetchall()

        result = [
            {
                "id":           r["id"],
                "title":        r["title"],
                "author_id":    r["author_id"],
                "author_name":  r["author_name"],
                "cover_url":    r["cover_url"] or "/static/images/placeholder.jpg",
                "nsfw":         bool(r["nsfw"]),
                "created_at":   r["created_at"].isoformat() if r["created_at"] else None,
                "total_views":  r["total_views"],
                "unique_views": r["unique_views"],
                "star_count":   r["star_count"],
                "is_starred":   bool(r["is_starred"]),
            }
            for r in rows
        ]

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── GET /api/fanfics/<id>  — full fanfic content + stats ─────────────────────

@fanfics_bp.route("/fanfics/<int:fanfic_id>", methods=["GET"])
def get_fanfic(fanfic_id):
    user = _get_user(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db  = get_db()
    uid = user["id"]

    try:
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT f.id, f.title, f.author_id,
                       u.username AS author_name,
                       f.content, f.cover_url, f.nsfw, f.created_at
                FROM fanfics f
                JOIN users u ON u.id = f.author_id
                WHERE f.id = %s
                """,
                (fanfic_id,)
            )
            fanfic = cur.fetchone()

        if not fanfic:
            return jsonify({"error": "Fanfic not found"}), 404

        with db.cursor() as cur:
            stats = _fanfic_stats(cur, fanfic_id)

            cur.execute(
                "SELECT 1 FROM fanfic_stars WHERE fanfic_id = %s AND user_id = %s",
                (fanfic_id, uid)
            )
            is_starred = cur.fetchone() is not None

        return jsonify({
            "id":           fanfic["id"],
            "title":        fanfic["title"],
            "author_id":    fanfic["author_id"],
            "author_name":  fanfic["author_name"],
            "content":      fanfic["content"],
            "cover_url":    fanfic["cover_url"] or "/static/images/placeholder.jpg",
            "nsfw":         bool(fanfic["nsfw"]),
            "created_at":   fanfic["created_at"].isoformat() if fanfic["created_at"] else None,
            "total_views":  stats["total_views"],
            "unique_views": stats["unique_views"],
            "is_starred":   is_starred,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── POST /api/fanfics  — upload a new fanfic ─────────────────────────────────

@fanfics_bp.route("/fanfics", methods=["POST"])
def upload_fanfic():
    user = _get_user(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()

    # Guard: only users with a valid activation key may post fanfics
    if not _check_fanfic_access(user["id"], db):
        return jsonify({"error": "Нет доступа к фанфикам. Обратитесь к администратору."}), 403

    # ── Parse multipart form fields ──────────────────────────────────────────
    title   = (request.form.get("title")   or "").strip()
    content = (request.form.get("content") or "").strip()
    nsfw    = request.form.get("nsfw", "false").lower() == "true"

    if not title:
        return jsonify({"error": "Заголовок обязателен"}), 400
    if not content:
        return jsonify({"error": "Текст фанфика обязателен"}), 400
    if len(title) > 255:
        return jsonify({"error": "Заголовок слишком длинный (макс. 255 символов)"}), 400

    cover_url = "/static/images/placeholder.jpg"   # default; updated below if a file is sent

    try:
        # ── Insert fanfic row (cover_url may be updated after we know the ID) ──
        with db.cursor() as cur:
            cur.execute(
                """
                INSERT INTO fanfics (title, author_id, content, cover_url, nsfw)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (title, user["id"], content, cover_url, 1 if nsfw else 0)
            )
            fanfic_id = cur.lastrowid

        # ── Save cover image when provided ────────────────────────────────────
        cover_file = request.files.get("cover")
        if cover_file and cover_file.filename:
            if not _allowed_cover(cover_file.filename):
                return jsonify({"error": "Недопустимый тип файла обложки (PNG, JPG, GIF, WEBP)"}), 400

            # Measure size without trusting Content-Length header
            cover_file.seek(0, 2)
            file_size = cover_file.tell()
            cover_file.seek(0)

            if file_size > MAX_COVER_SIZE_BYTES:
                return jsonify({"error": "Обложка слишком большая (макс. 5 МБ)"}), 413

            ext      = cover_file.filename.rsplit(".", 1)[1].lower()
            filename = secure_filename(f"cover_{fanfic_id}.{ext}")

            os.makedirs(FANFIC_COVER_FOLDER, exist_ok=True)
            cover_file.save(os.path.join(FANFIC_COVER_FOLDER, filename))

            cover_url = f"/static/uploads/fanfics/{filename}"

            # Patch the row with the real cover URL now that we have the ID
            with db.cursor() as cur:
                cur.execute(
                    "UPDATE fanfics SET cover_url = %s WHERE id = %s",
                    (cover_url, fanfic_id)
                )

        return jsonify({"id": fanfic_id, "message": "Фанфик загружен"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── POST /api/fanfics/<id>/view  — record a view ─────────────────────────────

@fanfics_bp.route("/fanfics/<int:fanfic_id>/view", methods=["POST"])
def record_view(fanfic_id):
    user = _get_user(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()

    try:
        with db.cursor() as cur:
            # Verify the fanfic exists before inserting a view
            cur.execute("SELECT id FROM fanfics WHERE id = %s", (fanfic_id,))
            if not cur.fetchone():
                return jsonify({"error": "Fanfic not found"}), 404

            # One row per view — COUNT(*) gives total, COUNT(DISTINCT user_id) gives unique
            cur.execute(
                "INSERT INTO fanfic_view_log (fanfic_id, user_id) VALUES (%s, %s)",
                (fanfic_id, user["id"])
            )

        return jsonify({"ok": True})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── POST /api/fanfics/<id>/star  — toggle bookmark ──────────────────────────

@fanfics_bp.route("/fanfics/<int:fanfic_id>/star", methods=["POST"])
def toggle_star(fanfic_id):
    user = _get_user(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db  = get_db()
    uid = user["id"]

    try:
        with db.cursor() as cur:
            cur.execute("SELECT id FROM fanfics WHERE id = %s", (fanfic_id,))
            if not cur.fetchone():
                return jsonify({"error": "Fanfic not found"}), 404

            cur.execute(
                "SELECT 1 FROM fanfic_stars WHERE fanfic_id = %s AND user_id = %s",
                (fanfic_id, uid)
            )
            already_starred = cur.fetchone() is not None

            if already_starred:
                cur.execute(
                    "DELETE FROM fanfic_stars WHERE fanfic_id = %s AND user_id = %s",
                    (fanfic_id, uid)
                )
                starred = False
            else:
                cur.execute(
                    "INSERT INTO fanfic_stars (fanfic_id, user_id) VALUES (%s, %s)",
                    (fanfic_id, uid)
                )
                starred = True

        return jsonify({"starred": starred})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── GET /api/fanfics/starred  — current user's bookmarks ────────────────────

@fanfics_bp.route("/fanfics/starred", methods=["GET"])
def get_starred():
    user = _get_user(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db  = get_db()
    uid = user["id"]

    try:
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT
                    f.id, f.title, f.author_id,
                    u.username                  AS author_name,
                    f.cover_url, f.nsfw, f.created_at,
                    COUNT(fvl.id)               AS total_views,
                    COUNT(DISTINCT fvl.user_id) AS unique_views
                FROM fanfic_stars fs
                JOIN  fanfics          f   ON  f.id  = fs.fanfic_id
                JOIN  users            u   ON  u.id  = f.author_id
                LEFT JOIN fanfic_view_log fvl ON fvl.fanfic_id = f.id
                WHERE fs.user_id = %s
                GROUP BY
                    f.id, f.title, f.author_id, u.username,
                    f.cover_url, f.nsfw, f.created_at
                ORDER BY fs.starred_at DESC
                """,
                (uid,)
            )
            rows = cur.fetchall()

        result = [
            {
                "id":           r["id"],
                "title":        r["title"],
                "author_id":    r["author_id"],
                "author_name":  r["author_name"],
                "cover_url":    r["cover_url"] or "/static/images/placeholder.jpg",
                "nsfw":         bool(r["nsfw"]),
                "created_at":   r["created_at"].isoformat() if r["created_at"] else None,
                "total_views":  r["total_views"],
                "unique_views": r["unique_views"],
            }
            for r in rows
        ]

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── GET /api/fanfics/author/<author_id>  — all works by one author ───────────

@fanfics_bp.route("/fanfics/author/<int:author_id>", methods=["GET"])
def get_author_fanfics(author_id):
    user = _get_user(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()

    try:
        with db.cursor() as cur:
            cur.execute(
                "SELECT id, username FROM users WHERE id = %s",
                (author_id,)
            )
            author = cur.fetchone()

        if not author:
            return jsonify({"error": "Author not found"}), 404

        with db.cursor() as cur:
            cur.execute(
                """
                SELECT
                    f.id,
                    f.title,
                    f.created_at,
                    COUNT(fvl.id)               AS total_views,
                    COUNT(DISTINCT fvl.user_id) AS unique_views,
                    -- Approximate word count via spaces (fast, good enough for stats)
                    LENGTH(TRIM(f.content))
                        - LENGTH(REPLACE(TRIM(f.content), ' ', '')) + 1 AS approx_words
                FROM fanfics f
                LEFT JOIN fanfic_view_log fvl ON fvl.fanfic_id = f.id
                WHERE f.author_id = %s
                GROUP BY f.id, f.title, f.created_at, f.content
                ORDER BY f.created_at DESC
                """,
                (author_id,)
            )
            works = cur.fetchall()

        # Aggregate totals for the author stats block
        total_fanfics = len(works)
        total_views   = sum(w["total_views"]   for w in works)
        total_unique  = sum(w["unique_views"]  for w in works)
        total_words   = sum(w["approx_words"] or 0 for w in works)
        avg_words     = round(total_words / total_fanfics) if total_fanfics else 0
        first_date    = (
            min(w["created_at"] for w in works).isoformat()
            if works else None
        )

        return jsonify({
            "author": {
                "id":       author["id"],
                "username": author["username"],
            },
            "stats": {
                "total_fanfics": total_fanfics,
                "total_views":   total_views,
                "total_unique":  total_unique,
                "total_words":   total_words,
                "avg_words":     avg_words,
                "first_date":    first_date,
            },
            "fanfics": [
                {
                    "id":           w["id"],
                    "title":        w["title"],
                    "created_at":   w["created_at"].isoformat() if w["created_at"] else None,
                    "total_views":  w["total_views"],
                    "unique_views": w["unique_views"],
                    "approx_words": w["approx_words"] or 0,
                }
                for w in works
            ],
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── GET /api/fanfics/global-stats  — site-wide statistics ────────────────────

@fanfics_bp.route("/fanfics/global-stats", methods=["GET"])
def global_stats():
    user = _get_user(request)
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    db = get_db()

    try:
        with db.cursor() as cur:
            cur.execute(
                """
                SELECT
                    f.id,
                    f.title,
                    COUNT(fvl.id)               AS total_views,
                    COUNT(DISTINCT fvl.user_id) AS unique_views
                FROM fanfics f
                LEFT JOIN fanfic_view_log fvl ON fvl.fanfic_id = f.id
                GROUP BY f.id, f.title
                """
            )
            rows = cur.fetchall()

        fanfic_count = len(rows)
        total_views  = sum(r["total_views"]  for r in rows)
        total_unique = sum(r["unique_views"] for r in rows)
        top          = max(rows, key=lambda r: r["total_views"]) if rows else None

        return jsonify({
            "fanfic_count": fanfic_count,
            "total_views":  total_views,
            "total_unique": total_unique,
            "top_fanfic":   {"title": top["title"], "views": top["total_views"]} if top else None,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500