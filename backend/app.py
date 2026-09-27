"""班级小岛 — single-class collection service. All timestamps are UTC."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import socket
import sqlite3
import time
import unicodedata
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, NoReturn
from urllib.parse import quote, urlparse

import exports
import httpx
from cryptography.fernet import Fernet
from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator

DATA = Path(os.getenv("DATA_DIR", Path(__file__).parent / "data"))
COOKIE = "island_session"
ALLOWED_EXT = {
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".txt",
    ".csv",
    ".zip",
}
MAX_FILE = 20 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def db():
    con = sqlite3.connect(DATA / "island.db", timeout=20)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def initialize():
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    (DATA / "uploads").mkdir(exist_ok=True, mode=0o700)
    keypath = DATA / "secret.key"
    try:
        with keypath.open("xb") as f:
            os.chmod(keypath, 0o600)
            f.write(Fernet.generate_key())
    except FileExistsError:
        pass
    with db() as c:
        c.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
          student_no TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student',
          status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
          deadline TEXT, published INTEGER NOT NULL DEFAULT 0, fields TEXT NOT NULL,
          created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS submissions (
          id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
          user_id INTEGER NOT NULL REFERENCES users(id), answers TEXT NOT NULL,
          updated_at TEXT NOT NULL, UNIQUE(project_id,user_id));
        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
          user_id INTEGER NOT NULL REFERENCES users(id), field_id TEXT NOT NULL,
          filename TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit (
          id INTEGER PRIMARY KEY, actor INTEGER, action TEXT NOT NULL, target TEXT NOT NULL,
          created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER, started REAL);
        CREATE TABLE IF NOT EXISTS file_deletions (id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS class_settings (
          id INTEGER PRIMARY KEY CHECK(id=1), class_name TEXT NOT NULL);
        INSERT OR IGNORE INTO class_settings VALUES(1, '我们的班级');
        """)


@asynccontextmanager
async def lifespan(app):
    initialize()
    purge_deleted_files()
    yield


app = FastAPI(title="班级小岛 API", lifespan=lifespan)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    # Custom header forces cross-origin browsers to preflight; no CORS is enabled.
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        if request.headers.get("X-Requested-With") != "class-island":
            return Response(
                '{"detail":"缺少安全请求头"}',
                status_code=403,
                media_type="application/json",
            )
        origin = request.headers.get("origin")
        expected = os.getenv(
            "APP_ORIGIN", f"{request.url.scheme}://{request.headers.get('host', '')}"
        )
        if origin and origin.rstrip("/") != expected.rstrip("/"):
            return Response(
                ' {"detail":"请求来源不允许"}',
                status_code=403,
                media_type="application/json",
            )
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Cache-Control"] = "no-store"
    return response


def fail(status, message) -> NoReturn:
    raise HTTPException(status, message)


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def password_hash(password):
    salt = secrets.token_bytes(16)
    value = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return base64.b64encode(salt + value).decode()


def password_ok(password, stored):
    raw = base64.b64decode(stored)
    return hmac.compare_digest(
        hashlib.scrypt(password.encode(), salt=raw[:16], n=16384, r=8, p=1), raw[16:]
    )


def public_user(row):
    return {
        k: row[k]
        for k in (
            "id",
            "username",
            "name",
            "student_no",
            "role",
            "status",
            "created_at",
        )
    }


def current_user(request: Request):
    token = request.cookies.get(COOKIE, "")
    with db() as c:
        row = c.execute(
            "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?",
            (digest(token), now()),
        ).fetchone()
    if not row:
        fail(401, "请先登录")
    if row["status"] != "approved":
        fail(403, "账号等待审核或已停用")
    return public_user(row)


def admin(user=Depends(current_user)):
    if user["role"] != "admin":
        fail(403, "仅管理员可以操作")
    return user


def purge_deleted_files():
    """Delete only committed tombstones. Failed filesystem cleanup retries at next startup."""
    with db() as c:
        for row in c.execute("SELECT id FROM file_deletions").fetchall():
            try:
                (DATA / "uploads" / row["id"]).unlink(missing_ok=True)
            except OSError:
                continue
            c.execute("DELETE FROM file_deletions WHERE id=?", (row["id"],))


def audit(c, actor, action, target):
    c.execute(
        "INSERT INTO audit(actor,action,target,created_at) VALUES(?,?,?,?)",
        (actor, action, str(target), now()),
    )


def throttle(request, scope, maximum):
    key = scope + ":" + (request.client.host if request.client else "unknown")
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        c.execute("DELETE FROM attempts WHERE started<?", (time.time() - 900,))
        row = c.execute("SELECT * FROM attempts WHERE key=?", (key,)).fetchone()
        if row and row["count"] >= maximum:
            fail(429, "操作过于频繁，请 15 分钟后重试")
        c.execute(
            "INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
            (key, time.time()),
        )


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)


class Registration(Credentials):
    name: str = Field(min_length=1, max_length=40)
    student_no: str = Field(min_length=1, max_length=40)

    @field_validator("name", "student_no")
    @classmethod
    def not_blank(cls, v):
        if not v.strip():
            raise ValueError("不能为空")
        return v.strip()


class NewPassword(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class ChangePassword(NewPassword):
    old_password: str = Field(max_length=128)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/auth/register", status_code=201)
def register(body: Registration, request: Request):
    throttle(request, "register", 15)
    try:
        with db() as c:
            c.execute(
                "INSERT INTO users(username,name,student_no,password,created_at) VALUES(?,?,?,?,?)",
                (
                    body.username.lower(),
                    body.name,
                    body.student_no,
                    password_hash(body.password),
                    now(),
                ),
            )
    except sqlite3.IntegrityError:
        fail(409, "用户名已被注册")
    return {"message": "注册成功，等待管理员审核后即可登录"}


@app.post("/api/auth/login")
def login(body: Credentials, response: Response, request: Request):
    throttle(request, "login", 60)
    with db() as c:
        row = c.execute("SELECT * FROM users WHERE username=?", (body.username.lower(),)).fetchone()
        if not row:
            # Keep the password verification cost for unknown usernames.
            password_hash(body.password)
            fail(401, "用户名或密码错误")
        if not password_ok(body.password, row["password"]):
            fail(401, "用户名或密码错误")
        if row["status"] != "approved":
            fail(403, "账号等待管理员审核或已停用，请联系班长")
        token = secrets.token_urlsafe(32)
        c.execute("DELETE FROM sessions WHERE expires<?", (now(),))
        c.execute(
            "INSERT INTO sessions VALUES(?,?,?)",
            (
                digest(token),
                row["id"],
                (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
            ),
        )
        response.set_cookie(
            COOKIE,
            token,
            httponly=True,
            secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
            samesite="lax",
            max_age=604800,
            path="/",
        )
        return public_user(row)


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    with db() as c:
        c.execute(
            "DELETE FROM sessions WHERE token=?",
            (digest(request.cookies.get(COOKIE, "")),),
        )
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(user=Depends(current_user)):
    return user


def clean_identity(value: str, allow_empty: bool = False) -> str:
    value = value.strip()
    if (not allow_empty and not value) or any(
        unicodedata.category(c) in {"Cc", "Cs"} for c in value
    ):
        raise ValueError("名称不能为空或包含控制字符")
    return value


class ClassSettingsIn(BaseModel):
    class_name: str = Field(min_length=1, max_length=80)

    @field_validator("class_name")
    @classmethod
    def validate_name(cls, value):
        return clean_identity(value)


class AdminProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    student_no: str | None = Field(default=None, max_length=40)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value):
        return clean_identity(value)

    @field_validator("student_no")
    @classmethod
    def validate_student_no(cls, value):
        return clean_identity(value, allow_empty=True) if value is not None else None


def read_class_settings(c):
    row = c.execute("SELECT class_name FROM class_settings WHERE id=1").fetchone()
    return {"class_name": row["class_name"] if row else "我们的班级"}


@app.get("/api/class-settings")
def class_settings(user=Depends(current_user)):
    with db() as c:
        return read_class_settings(c)


@app.put("/api/class-settings")
def update_class_settings(body: ClassSettingsIn, user=Depends(admin)):
    with db() as c:
        c.execute(
            "INSERT INTO class_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET class_name=excluded.class_name",
            (body.class_name,),
        )
        audit(c, user["id"], "update_class_settings", "class")
        return read_class_settings(c)


@app.put("/api/admin/profile")
def update_admin_profile(body: AdminProfileIn, user=Depends(admin)):
    with db() as c:
        student_no = body.student_no if body.student_no is not None else user["student_no"]
        c.execute(
            "UPDATE users SET name=?,student_no=? WHERE id=?", (body.name, student_no, user["id"])
        )
        audit(c, user["id"], "update_admin_profile", user["id"])
        return public_user(c.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone())


@app.put("/api/auth/password")
def change_password(body: ChangePassword, user=Depends(current_user)):
    with db() as c:
        stored = c.execute("SELECT password FROM users WHERE id=?", (user["id"],)).fetchone()[0]
        if not password_ok(body.old_password, stored):
            fail(400, "原密码错误")
        c.execute(
            "UPDATE users SET password=? WHERE id=?",
            (password_hash(body.password), user["id"]),
        )
        c.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
    return {"message": "密码已修改，请重新登录"}


@app.get("/api/users")
def users(user=Depends(admin)):
    with db() as c:
        return [public_user(r) for r in c.execute("SELECT * FROM users ORDER BY created_at DESC")]


class UserStatus(BaseModel):
    status: Literal["approved", "rejected", "pending"]


@app.patch("/api/users/{uid}/status")
def user_status(uid: int, body: UserStatus, user=Depends(admin)):
    with db() as c:
        target = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not target:
            fail(404, "用户不存在")
        if target["role"] == "admin":
            fail(400, "不能停用超级管理员")
        c.execute("UPDATE users SET status=? WHERE id=?", (body.status, uid))
        c.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
        audit(c, user["id"], "user_status:" + body.status, uid)
    return {"ok": True}


@app.put("/api/users/{uid}/password")
def reset_password(uid: int, body: NewPassword, user=Depends(admin)):
    with db() as c:
        if not c.execute("SELECT id FROM users WHERE id=?", (uid,)).fetchone():
            fail(404, "用户不存在")
        c.execute(
            "UPDATE users SET password=? WHERE id=?",
            (password_hash(body.password), uid),
        )
        c.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
        audit(c, user["id"], "reset_password", uid)
    return {"ok": True}


class Question(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str = Field(min_length=1, max_length=150)
    type: Literal["text", "textarea", "number", "date", "select", "file"] = "text"
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=50)
    help: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def check(self):
        if not self.label.strip():
            raise ValueError("问题标题不能为空")
        if self.type == "select" and (
            not self.options
            or any(not x.strip() or len(x) > 150 for x in self.options)
            or len(set(self.options)) != len(self.options)
        ):
            raise ValueError("单选题需要不重复的非空选项，每项不超过 150 字")
        return self


class ProjectIn(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    description: str = Field(default="", max_length=5000)
    deadline: datetime | None = None
    published: bool = False
    fields: list[Question] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def check(self):
        if not self.title.strip():
            raise ValueError("标题不能为空")
        if len({f.id for f in self.fields}) != len(self.fields):
            raise ValueError("问题 ID 不能重复")
        if self.deadline and self.deadline.tzinfo is None:
            raise ValueError("截止时间必须包含时区")
        return self


def stored_json(value):
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        fail(500, "存储数据损坏，请联系管理员恢复备份")


def project_out(row):
    obj = dict(row)
    obj["fields"] = stored_json(obj["fields"])
    obj["published"] = bool(obj["published"])
    obj["expired"] = bool(obj["deadline"] and obj["deadline"] <= now())
    return obj


def get_project(c, pid, user):
    row = c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    if not row or (not row["published"] and user["role"] != "admin"):
        fail(404, "项目不存在或尚未发布")
    return project_out(row)


def editable(project, user):
    if project["expired"] and user["role"] != "admin":
        fail(403, "已过截止时间，不能提交或修改，请联系管理员")


def project_values(body):
    return (
        body.title.strip(),
        body.description,
        body.deadline.astimezone(timezone.utc).isoformat() if body.deadline else None,
        body.published,
        json.dumps([f.model_dump() for f in body.fields], ensure_ascii=False),
    )


@app.get("/api/projects")
def projects(user=Depends(current_user)):
    with db() as c:
        rows = c.execute(
            "SELECT p.*, (SELECT count(*) FROM submissions s WHERE s.project_id=p.id) AS submission_count, (SELECT updated_at FROM submissions s WHERE s.project_id=p.id AND s.user_id=?) AS my_submitted_at FROM projects p WHERE p.published=1 OR ?='admin' ORDER BY p.created_at DESC",
            (user["id"], user["role"]),
        ).fetchall()
        result = [project_out(r) for r in rows]
        if user["role"] != "admin":
            for p in result:
                p.pop("submission_count", None)
        return result


@app.post("/api/projects", status_code=201)
def create_project(body: ProjectIn, user=Depends(admin)):
    with db() as c:
        cur = c.execute(
            "INSERT INTO projects(title,description,deadline,published,fields,created_at) VALUES(?,?,?,?,?,?)",
            (*project_values(body), now()),
        )
        audit(c, user["id"], "create_project", cur.lastrowid)
        return get_project(c, cur.lastrowid, user)


@app.get("/api/projects/{pid}")
def project(pid: int, user=Depends(current_user)):
    with db() as c:
        return get_project(c, pid, user)


@app.put("/api/projects/{pid}")
def update_project(pid: int, body: ProjectIn, user=Depends(admin)):
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        old = get_project(c, pid, user)
        if c.execute("SELECT id FROM submissions WHERE project_id=? LIMIT 1", (pid,)).fetchone():
            new_fields = {f.id: f for f in body.fields}
            for f in old["fields"]:
                new = new_fields.get(f["id"])
                if (
                    not new
                    or new.type != f["type"]
                    or (f["type"] == "select" and not set(f["options"]).issubset(new.options))
                ):
                    fail(
                        409,
                        "已有提交，不能删除问题、更换题型或删除已有选项；请新建项目",
                    )
        c.execute(
            "UPDATE projects SET title=?,description=?,deadline=?,published=?,fields=? WHERE id=?",
            (*project_values(body), pid),
        )
        audit(c, user["id"], "update_project", pid)
        return get_project(c, pid, user)


class AnswersIn(BaseModel):
    answers: dict = Field(default_factory=dict)


def submission_out(c, row):
    obj = dict(row)
    obj["answers"] = stored_json(obj["answers"])
    obj["files"] = {}
    for value in obj["answers"].values():
        if isinstance(value, list):
            for fid in value:
                f = c.execute(
                    "SELECT id,filename,size FROM attachments WHERE id=?", (fid,)
                ).fetchone()
                if f:
                    obj["files"][fid] = dict(f)
    return obj


@app.get("/api/projects/{pid}/submission")
def my_submission(pid: int, user_id: int | None = None, user=Depends(current_user)):
    uid = user_id if user_id is not None else user["id"]
    if uid != user["id"] and user["role"] != "admin":
        fail(403, "只能查看自己的填写信息")
    with db() as c:
        get_project(c, pid, user)
        row = c.execute(
            "SELECT * FROM submissions WHERE project_id=? AND user_id=?", (pid, uid)
        ).fetchone()
        return submission_out(c, row) if row else {"answers": {}, "files": {}, "updated_at": None}


def validate_answers(c, p, uid, answers):
    fields = {f["id"]: f for f in p["fields"]}
    if set(answers) - set(fields):
        fail(422, "问卷已更新，请刷新后重试")
    for fid, f in fields.items():
        value = answers.get(fid)
        empty = (
            value is None
            or value == ""
            or value == []
            or (isinstance(value, str) and not value.strip())
        )
        if empty:
            if f["required"]:
                fail(422, f"请填写：{f['label']}")
            continue
        if f["type"] == "file":
            if (
                not isinstance(value, list)
                or len(value) > 10
                or any(not isinstance(x, str) for x in value)
                or len(set(value)) != len(value)
            ):
                fail(422, "每题最多上传 10 个不重复的附件")
            for aid in value:
                if not c.execute(
                    "SELECT id FROM attachments WHERE id=? AND project_id=? AND user_id=? AND field_id=?",
                    (aid, p["id"], uid, fid),
                ).fetchone():
                    fail(422, "附件不存在或不属于当前填写人及问题")
        else:
            if not isinstance(value, str) or len(value) > 10000:
                fail(422, "答案应为不超过 10000 字的文本")
            if f["type"] == "select" and value not in f["options"]:
                fail(422, f"{f['label']}：请选择有效选项")
            if f["type"] == "number":
                try:
                    import math

                    if not math.isfinite(float(value)):
                        raise ValueError()
                except ValueError:
                    fail(422, f"{f['label']}：请输入数字")
            if f["type"] == "date":
                try:
                    from datetime import date

                    date.fromisoformat(value)
                except ValueError:
                    fail(422, f"{f['label']}：请输入有效日期")


@app.put("/api/projects/{pid}/submission")
def save_submission(
    pid: int, body: AnswersIn, user_id: int | None = None, user=Depends(current_user)
):
    uid = user_id if user_id is not None else user["id"]
    if uid != user["id"] and user["role"] != "admin":
        fail(403, "只能修改自己的填写信息")
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        p = get_project(c, pid, user)
        editable(p, user)
        if not c.execute("SELECT id FROM users WHERE id=?", (uid,)).fetchone():
            fail(404, "用户不存在")
        validate_answers(c, p, uid, body.answers)
        c.execute(
            "INSERT INTO submissions(project_id,user_id,answers,updated_at) VALUES(?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET answers=excluded.answers,updated_at=excluded.updated_at",
            (pid, uid, json.dumps(body.answers, ensure_ascii=False), now()),
        )
        audit(c, user["id"], "save_submission", f"{pid}:{uid}")
    return {"ok": True}


@app.delete("/api/projects/{pid}")
def delete_project(pid: int, user=Depends(admin)):
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        get_project(c, pid, user)
        c.execute(
            "INSERT OR IGNORE INTO file_deletions SELECT id FROM attachments WHERE project_id=?",
            (pid,),
        )
        c.execute("DELETE FROM submissions WHERE project_id=?", (pid,))
        c.execute("DELETE FROM attachments WHERE project_id=?", (pid,))
        c.execute("DELETE FROM projects WHERE id=?", (pid,))
        audit(c, user["id"], "delete_project", pid)
    purge_deleted_files()
    return {"ok": True}


@app.delete("/api/projects/{pid}/submission")
def withdraw_submission(pid: int, user_id: int | None = None, user=Depends(current_user)):
    uid = user_id if user_id is not None else user["id"]
    if uid != user["id"] and user["role"] != "admin":
        fail(403, "只能撤回自己的填写信息")
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        p = get_project(c, pid, user)
        editable(p, user)
        if not c.execute(
            "SELECT id FROM submissions WHERE project_id=? AND user_id=?", (pid, uid)
        ).fetchone():
            fail(404, "尚未提交或填写信息已撤回")
        c.execute(
            "INSERT OR IGNORE INTO file_deletions SELECT id FROM attachments WHERE project_id=? AND user_id=?",
            (pid, uid),
        )
        c.execute("DELETE FROM submissions WHERE project_id=? AND user_id=?", (pid, uid))
        c.execute("DELETE FROM attachments WHERE project_id=? AND user_id=?", (pid, uid))
        audit(c, user["id"], "withdraw_submission", f"{pid}:{uid}")
    purge_deleted_files()
    return {"ok": True}


@app.get("/api/projects/{pid}/submissions")
def all_submissions(pid: int, user=Depends(admin)):
    with db() as c:
        get_project(c, pid, user)
        rows = c.execute(
            "SELECT s.*,u.name,u.student_no,u.username FROM submissions s JOIN users u ON s.user_id=u.id WHERE project_id=? ORDER BY s.updated_at DESC",
            (pid,),
        ).fetchall()
        return [submission_out(c, r) for r in rows]


@app.post("/api/projects/{pid}/files/{field_id}", status_code=201)
def upload(
    pid: int,
    field_id: str,
    file: UploadFile = File(...),
    user_id: int | None = None,
    user=Depends(current_user),
):
    uid = user_id if user_id is not None else user["id"]
    if uid != user["id"] and user["role"] != "admin":
        fail(403, "只能为自己上传附件")
    filename = Path((file.filename or "file").replace("\\", "/")).name
    if (
        len(filename) > 200
        or Path(filename).suffix.lower() not in ALLOWED_EXT
        or any(ord(x) < 32 for x in filename)
    ):
        fail(422, "文件名无效或类型不支持，请上传图片、PDF、Office 文档、文本或 ZIP")
    aid = secrets.token_hex(24)
    dest = DATA / "uploads" / aid
    size = 0
    try:
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            p = get_project(c, pid, user)
            editable(p, user)
            if not any(f["id"] == field_id and f["type"] == "file" for f in p["fields"]):
                fail(422, "此问题不支持附件")
            if not c.execute("SELECT id FROM users WHERE id=?", (uid,)).fetchone():
                fail(404, "用户不存在")
            total = c.execute(
                "SELECT COALESCE(SUM(size),0) FROM attachments WHERE user_id=? AND project_id=?",
                (uid, pid),
            ).fetchone()[0]
            if total >= 200 * 1024 * 1024:
                fail(413, "该项目个人附件总量已达 200 MB，请联系管理员")
            with dest.open("xb") as output:
                while chunk := file.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_FILE or total + size > 200 * 1024 * 1024:
                        fail(413, "单文件限 20 MB，该项目个人附件总量限 200 MB")
                    output.write(chunk)
            if not size:
                fail(422, "不能上传空文件")
            # Recheck after the transfer, not just before it.
            if p["deadline"] and p["deadline"] <= now() and user["role"] != "admin":
                fail(403, "上传期间已过截止时间")
            c.execute(
                "INSERT INTO attachments VALUES(?,?,?,?,?,?,?)",
                (aid, pid, uid, field_id, filename, size, now()),
            )
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    finally:
        file.file.close()
    return {"id": aid, "filename": filename, "size": size}


@app.get("/api/files/{aid}")
def download(aid: str, user=Depends(current_user)):
    with db() as c:
        row = c.execute("SELECT * FROM attachments WHERE id=?", (aid,)).fetchone()
        if not row:
            fail(404, "附件不存在")
        if row["user_id"] != user["id"] and user["role"] != "admin":
            fail(403, "无权下载他人附件")
        get_project(c, row["project_id"], user)
        path = DATA / "uploads" / row["id"]
        if not path.is_file():
            fail(404, "附件文件不存在，请联系管理员")
        return FileResponse(path, filename=row["filename"], media_type="application/octet-stream")


@app.get("/api/projects/{pid}/export")
def export(pid: int, format: Literal["xlsx", "zip"] = "xlsx", user=Depends(admin)):
    assets = []
    total = 0
    with db() as c:
        # A consistent snapshot; concurrent deletion cannot remove files during packaging.
        c.execute("BEGIN IMMEDIATE")
        p = get_project(c, pid, user)
        p["class_name"] = read_class_settings(c)["class_name"]
        filename = exports.export_filename(p["class_name"], p["title"], format)
        rows = c.execute(
            "SELECT s.*,u.name,u.student_no FROM submissions s JOIN users u ON u.id=s.user_id WHERE project_id=? ORDER BY u.student_no,u.id",
            (pid,),
        ).fetchall()
        records = []
        for row in rows:
            record = dict(row)
            record["answers"] = stored_json(row["answers"])
            records.append(record)
            for index, question in enumerate(p["fields"], 1):
                if question["type"] != "file":
                    continue
                for aid in record["answers"].get(question["id"], []) or []:
                    item = c.execute(
                        "SELECT * FROM attachments WHERE id=? AND project_id=? AND user_id=? AND field_id=?",
                        (aid, pid, row["user_id"], question["id"]),
                    ).fetchone()
                    if not item:
                        fail(409, "附件记录缺失，无法生成完整导出，请先修复资料")
                    if (
                        total + item["size"] > exports.MAX_EXPORT_BYTES
                        or len(assets) >= exports.MAX_EXPORT_FILES
                    ):
                        fail(
                            413,
                            "单次导出限 100 MB 原附件及 500 个文件，请拆分收集项目或联系管理员处理",
                        )
                    try:
                        with (DATA / "uploads" / aid).open("rb") as source:
                            data = source.read(exports.MAX_EXPORT_BYTES - total + 1)
                    except OSError:
                        fail(409, f"附件文件缺失或不可读：{item['filename']}，请恢复备份后再导出")
                    if len(data) != item["size"]:
                        fail(409, f"附件大小异常：{item['filename']}，请核对原文件")
                    total += len(data)
                    path = f"attachments/u{row['user_id']}/q{index}/{aid}-{exports.portable_name(item['filename'])}"
                    assets.append(
                        exports.Asset(
                            aid,
                            row["user_id"],
                            row["name"],
                            question["label"],
                            item["filename"],
                            data,
                            path,
                        )
                    )
        payload = (
            exports.build_zip(p, records, assets)
            if format == "zip"
            else exports.build_workbook(p, records, assets, embedded=True)
        )
        audit(c, user["id"], "export:" + format, pid)
    return Response(
        payload,
        media_type="application/zip"
        if format == "zip"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=\"export.{format}\"; filename*=UTF-8''{quote(filename, safe='')}"
        },
    )


class AIConfig(BaseModel):
    base_url: str = Field(default="https://api.openai.com/v1", max_length=500)
    model: str = Field(default="gpt-4o-mini", min_length=1, max_length=100)
    api_key: str = Field(default="", max_length=500)
    clear_key: bool = False


def validate_ai_url(url):
    try:
        parsed = urlparse(url)
        valid = (
            parsed.scheme == "https"
            and parsed.hostname
            and not (parsed.username or parsed.password or parsed.query or parsed.fragment)
            and parsed.port in (None, 443)
        )
    except ValueError:
        fail(422, "AI 地址格式不正确")
    if not valid:
        fail(422, "AI 地址必须是无账号、查询参数的 HTTPS 地址（443 端口）")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    except OSError:
        fail(422, "无法解析 AI 服务地址")
    if not addresses or any(not ipaddress.ip_address(x[4][0]).is_global for x in addresses):
        fail(422, "不能连接本机、内网或保留地址")
    return str(addresses[0][4][0])


def cipher():
    return Fernet((DATA / "secret.key").read_bytes())


def read_config(c):
    row = c.execute("SELECT value FROM settings WHERE id=1").fetchone()
    return (
        stored_json(row[0])
        if row
        else {
            "base_url": "https://api.openai.com/v1",
            "model": "gpt-4o-mini",
            "key": "",
        }
    )


@app.get("/api/ai/config")
def ai_config(user=Depends(admin)):
    with db() as c:
        config = read_config(c)
    return {
        "base_url": config["base_url"],
        "model": config["model"],
        "has_key": bool(config["key"]),
    }


@app.put("/api/ai/config")
def set_ai_config(body: AIConfig, user=Depends(admin)):
    validate_ai_url(body.base_url)
    with db() as c:
        config = read_config(c)
        key = "" if body.clear_key else config["key"]
        if body.api_key:
            key = cipher().encrypt(body.api_key.encode()).decode()
        config = {
            "base_url": body.base_url.rstrip("/"),
            "model": body.model,
            "key": key,
        }
        c.execute(
            "INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
            (json.dumps(config),),
        )
        audit(c, user["id"], "ai_config", "settings")
    return {"ok": True}


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=12000)


class ChatIn(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=30)


@app.post("/api/ai/chat")
async def chat(body: ChatIn, request: Request, user=Depends(admin)):
    throttle(request, "ai", 40)
    if sum(len(m.content) for m in body.messages) > 60000:
        fail(422, "对话过长，请清空后重试")
    with db() as c:
        config = read_config(c)
    if not config["key"]:
        fail(400, "请先配置 AI API Key")
    address = validate_ai_url(config["base_url"])
    parsed = urlparse(config["base_url"])
    # Pin the validated IP: no second DNS lookup (DNS rebinding), while preserving TLS SNI/certificate checks.
    host = f"[{address}]" if ":" in address else address
    target = f"https://{host}{parsed.path.rstrip('/')}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=False, trust_env=False) as client:
            res = await client.post(
                target,
                extensions={"sni_hostname": parsed.hostname},
                headers={
                    "Host": parsed.netloc,
                    "Authorization": "Bearer " + cipher().decrypt(config["key"].encode()).decode(),
                },
                json={
                    "model": config["model"],
                    "messages": [
                        {
                            "role": "system",
                            "content": "你是班级小岛助手。协助班长起草通知、设计问卷和规划工作。你无法读取或操作系统的学生资料及附件，不能声称已执行文件或系统操作。",
                        }
                    ]
                    + [m.model_dump() for m in body.messages],
                    "max_tokens": 2000,
                },
            )
            res.raise_for_status()
            text = res.json()["choices"][0]["message"]["content"]
            if not isinstance(text, str) or not text:
                raise ValueError("Invalid AI response")
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        fail(502, "AI 服务连接失败或返回格式不兼容，请检查地址、模型和密钥")
    return {"content": text}


def create_admin(username, name, password):
    Credentials(username=username, password=password)
    initialize()
    with db() as c:
        if c.execute("SELECT id FROM users WHERE username=?", (username.lower(),)).fetchone():
            raise ValueError("用户名已存在；此命令不会覆盖已有账号")
        c.execute(
            "INSERT INTO users(username,name,student_no,password,role,status,created_at) VALUES(?,?,?,?, 'admin','approved',?)",
            (username.lower(), name, "", password_hash(password), now()),
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["create-admin"])
    parser.add_argument("--username", default="admin")
    parser.add_argument("--name", default="班长")
    args = parser.parse_args()
    import getpass

    secret = os.getenv("ADMIN_PASSWORD") or getpass.getpass("管理员密码（至少 8 位）：")
    create_admin(args.username, args.name, secret)
    print("管理员已创建。请妥善保管密码。")
