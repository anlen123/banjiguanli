import sqlite3
from pathlib import Path

import app as service
import pytest
from fastapi.testclient import TestClient
from test_app import HEADERS, make_project
from test_app import clients as clients


def test_delete_user_requires_admin_and_security_headers(clients):
    root, student, other = clients
    uid = student.get("/api/auth/me").json()["id"]
    url = f"/api/users/{uid}"
    assert student.delete(url).status_code == 403
    assert other.delete(url).status_code == 403
    with TestClient(service.app, headers=HEADERS) as anonymous:
        assert anonymous.delete(url).status_code == 401
    assert root.delete(url, headers={"X-Requested-With": ""}).status_code == 403
    assert root.delete(url, headers={"Origin": "https://evil.invalid"}).status_code == 403
    assert student.get("/api/auth/me").status_code == 200
    assert any(u["id"] == uid for u in root.get("/api/users").json())


def test_delete_user_protects_admin_and_handles_missing_user(clients):
    root, _, _ = clients
    uid = root.get("/api/auth/me").json()["id"]
    response = root.delete(f"/api/users/{uid}")
    assert response.status_code == 400
    assert response.json()["detail"] == "不能删除超级管理员"
    assert root.get("/api/auth/me").status_code == 200
    assert root.delete("/api/users/999999").status_code == 404
    with service.db() as c:
        assert c.execute("SELECT COUNT(*) FROM audit WHERE action='delete_user'").fetchone()[0] == 0


@pytest.mark.parametrize("status", ["pending", "approved", "rejected"])
def test_delete_user_in_any_status_and_allow_registration_again(clients, status):
    root, student, _ = clients
    uid = student.get("/api/auth/me").json()["id"]
    assert root.patch(f"/api/users/{uid}/status", json={"status": status}).status_code == 200
    response = root.delete(f"/api/users/{uid}")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert all(u["id"] != uid for u in root.get("/api/users").json())
    assert root.delete(f"/api/users/{uid}").status_code == 404
    assert (
        student.post(
            "/api/auth/login", json={"username": "student", "password": "student123"}
        ).status_code
        == 401
    )
    with service.db() as c:
        logs = c.execute("SELECT actor,target FROM audit WHERE action='delete_user'").fetchall()
        assert len(logs) == 1
        assert logs[0]["actor"] == root.get("/api/auth/me").json()["id"]
        assert logs[0]["target"] == str(uid)
    assert (
        student.post(
            "/api/auth/register",
            json={
                "username": "student",
                "password": "replacement123",
                "name": "重新注册",
                "student_no": "001",
            },
        ).status_code
        == 201
    )
    assert (
        next(u for u in root.get("/api/users").json() if u["username"] == "student")["status"]
        == "pending"
    )


def test_delete_user_cleans_all_projects_and_sessions_only_for_target(clients):
    root, student, other = clients
    uid = student.get("/api/auth/me").json()["id"]
    target_files = []
    other_files = []
    projects = [make_project(root)[0], make_project(root)[0]]
    for project in projects:
        pid = project["id"]
        for client, files in [(student, target_files), (other, other_files)]:
            upload = client.post(
                f"/api/projects/{pid}/files/file", files={"file": ("资料.pdf", b"original")}
            )
            assert upload.status_code == 201
            fid = upload.json()["id"]
            files.append(fid)
            assert (
                client.put(
                    f"/api/projects/{pid}/submission",
                    json={"answers": {"name": "资料", "file": [fid]}},
                ).status_code
                == 200
            )
        # Unsubmitted uploads must also be removed.
        upload = student.post(
            f"/api/projects/{pid}/files/file", files={"file": ("未提交.pdf", b"draft")}
        )
        assert upload.status_code == 201
        target_files.append(upload.json()["id"])
    assert all(p["submission_count"] == 2 for p in root.get("/api/projects").json())
    with TestClient(service.app, headers=HEADERS) as second_session:
        assert (
            second_session.post(
                "/api/auth/login", json={"username": "student", "password": "student123"}
            ).status_code
            == 200
        )
        assert root.delete(f"/api/users/{uid}").status_code == 200
        assert second_session.get("/api/auth/me").status_code == 401
    assert student.get("/api/auth/me").status_code == 401
    assert other.get("/api/auth/me").status_code == 200
    assert root.get("/api/auth/me").status_code == 200
    for fid in target_files:
        assert root.get(f"/api/files/{fid}").status_code == 404
        assert not (service.DATA / "uploads" / fid).exists()
    for fid in other_files:
        assert root.get(f"/api/files/{fid}").content == b"original"
    for project in projects:
        assert root.get(f"/api/projects/{project['id']}").status_code == 200
        submissions = root.get(f"/api/projects/{project['id']}/submissions").json()
        assert len(submissions) == 1
        assert submissions[0]["user_id"] == other.get("/api/auth/me").json()["id"]
    assert all(p["submission_count"] == 1 for p in root.get("/api/projects").json())
    with service.db() as c:
        assert c.execute("SELECT COUNT(*) FROM sessions WHERE user_id=?", (uid,)).fetchone()[0] == 0
        assert (
            c.execute("SELECT COUNT(*) FROM submissions WHERE user_id=?", (uid,)).fetchone()[0] == 0
        )
        assert (
            c.execute("SELECT COUNT(*) FROM attachments WHERE user_id=?", (uid,)).fetchone()[0] == 0
        )
        assert c.execute("SELECT COUNT(*) FROM file_deletions").fetchone()[0] == 0
        # Existing audit history is retained even though the actor's account is removed.
        assert c.execute("SELECT COUNT(*) FROM audit WHERE actor=?", (uid,)).fetchone()[0] == 2
        assert not c.execute("PRAGMA foreign_key_check").fetchall()


def test_delete_user_rolls_back_data_and_file_tombstones_on_failure(clients, monkeypatch):
    root, student, _ = clients
    uid = student.get("/api/auth/me").json()["id"]
    project, _ = make_project(root)
    pid = project["id"]
    fid = student.post(
        f"/api/projects/{pid}/files/file", files={"file": ("资料.pdf", b"original")}
    ).json()["id"]
    assert (
        student.put(
            f"/api/projects/{pid}/submission",
            json={"answers": {"name": "资料", "file": [fid]}},
        ).status_code
        == 200
    )

    def broken_audit(*args):
        raise sqlite3.OperationalError("simulated audit failure")

    with monkeypatch.context() as patch:
        patch.setattr(service, "audit", broken_audit)
        with pytest.raises(sqlite3.OperationalError, match="simulated audit failure"):
            root.delete(f"/api/users/{uid}")
    assert student.get("/api/auth/me").status_code == 200
    assert any(u["id"] == uid for u in root.get("/api/users").json())
    assert root.get(f"/api/files/{fid}").content == b"original"
    assert len(root.get(f"/api/projects/{pid}/submissions").json()) == 1
    with service.db() as c:
        assert c.execute("SELECT COUNT(*) FROM file_deletions").fetchone()[0] == 0
        assert not c.execute("PRAGMA foreign_key_check").fetchall()


def test_delete_user_retries_failed_file_cleanup(clients, monkeypatch):
    root, student, _ = clients
    uid = student.get("/api/auth/me").json()["id"]
    project, _ = make_project(root)
    fid = student.post(
        f"/api/projects/{project['id']}/files/file", files={"file": ("资料.pdf", b"original")}
    ).json()["id"]
    path = service.DATA / "uploads" / fid
    original_unlink = Path.unlink

    def failed_unlink(self, *args, **kwargs):
        if self == path:
            raise OSError("simulated file cleanup failure")
        return original_unlink(self, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "unlink", failed_unlink)
        assert root.delete(f"/api/users/{uid}").status_code == 200
        assert path.exists()
        assert root.get(f"/api/files/{fid}").status_code == 404
        with service.db() as c:
            assert c.execute("SELECT id FROM file_deletions").fetchone()["id"] == fid
    service.purge_deleted_files()
    assert not path.exists()
    with service.db() as c:
        assert c.execute("SELECT COUNT(*) FROM file_deletions").fetchone()[0] == 0
