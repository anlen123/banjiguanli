from datetime import datetime, timedelta, timezone

import app as service
from test_app import clients as clients
from test_app import make_project


def test_admin_can_submit_modify_and_withdraw_own_data(clients):
    root, student, _ = clients
    p, _ = make_project(root, deadline=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat())
    url = f"/api/projects/{p['id']}/submission"
    assert root.put(url, json={"answers": {"name": "班长自己"}}).status_code == 200
    assert root.get(url).json()["answers"]["name"] == "班长自己"
    assert root.get("/api/projects").json()[0]["my_submitted_at"]
    assert len(root.get(f"/api/projects/{p['id']}/submissions").json()) == 1
    assert student.get(url).json()["answers"] == {}
    assert root.put(url, json={"answers": {"name": "修改班长资料"}}).status_code == 200
    assert root.delete(url).status_code == 200
    assert root.get(url).json()["updated_at"] is None


def test_withdraw_ownership_deadline_and_attachment_cleanup(clients):
    root, student, other = clients
    p, body = make_project(root)
    pid = p["id"]
    uid = student.get("/api/auth/me").json()["id"]
    url = f"/api/projects/{pid}/submission"
    fid = student.post(f"/api/projects/{pid}/files/file", files={"file": ("a.pdf", b"original")}).json()["id"]
    assert student.put(url, json={"answers": {"name": "student", "file": [fid]}}).status_code == 200
    assert other.delete(url + f"?user_id={uid}").status_code == 403
    assert student.delete(url).status_code == 200
    assert student.get(url).json()["updated_at"] is None
    assert root.get(f"/api/files/{fid}").status_code == 404
    assert not (service.DATA / "uploads" / fid).exists()
    assert student.put(url, json={"answers": {"name": "again", "file": [fid]}}).status_code == 422
    assert student.put(url, json={"answers": {"name": "重新填写"}}).status_code == 200
    body["deadline"] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    assert root.put(f"/api/projects/{pid}", json=body).status_code == 200
    assert student.delete(url).status_code == 403
    assert root.delete(url + f"?user_id={uid}").status_code == 200


def test_project_delete_cleans_only_target_project(clients):
    root, student, _ = clients
    p, _ = make_project(root)
    other, _ = make_project(root)
    pids = [p["id"], other["id"]]
    fids = []
    for pid in pids:
        fid = student.post(f"/api/projects/{pid}/files/file", files={"file": ("a.pdf", b"original")}).json()["id"]
        fids.append(fid)
        assert student.put(f"/api/projects/{pid}/submission", json={"answers": {"name": "x", "file": [fid]}}).status_code == 200
    assert student.delete(f"/api/projects/{p['id']}").status_code == 403
    assert root.delete(f"/api/projects/{p['id']}").status_code == 200
    assert root.get(f"/api/projects/{p['id']}").status_code == 404
    assert root.get(f"/api/projects/{p['id']}/export").status_code == 404
    assert root.get(f"/api/files/{fids[0]}").status_code == 404
    assert not (service.DATA / "uploads" / fids[0]).exists()
    assert root.get(f"/api/files/{fids[1]}").content == b"original"
    assert root.get(f"/api/projects/{other['id']}/submissions").json()
    with service.db() as c:
        assert c.execute("SELECT COUNT(*) FROM audit WHERE action='delete_project'").fetchone()[0] == 1
