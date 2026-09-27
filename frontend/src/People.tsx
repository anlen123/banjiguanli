import { useEffect, useState, type FormEvent } from "react";
import { Button } from "animal-island-ui";
import {
  Check,
  KeyRound,
  Search,
  ShieldCheck,
  UserRound,
  RefreshCw,
} from "lucide-react";
import { api, errorMessage, type User } from "./api";
import { Badge, Dialog, Empty, ErrorNotice, Loading } from "./ui";

export function People({ onChanged }: { onChanged: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [reset, setReset] = useState<User | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<User[]>("/users")
      .then((u) => {
        if (active) setUsers(u);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [version]);
  async function status(user: User, value: User["status"]) {
    if (
      value === "rejected" &&
      !window.confirm(
        `确定${user.status === "pending" ? "拒绝" : "停用"} ${user.name} 的账号？该用户将无法登录。`,
      )
    )
      return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api(`/users/${user.id}/status`, "PATCH", { status: value });
      setVersion((v) => v + 1);
      onChanged();
      setSuccess("账号状态已更新");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    if (!reset) return;
    setBusy(true);
    setPasswordError("");
    try {
      await api(`/users/${reset.id}/password`, "PUT", { password });
      setReset(null);
      setPassword("");
      setSuccess(
        "密码已重置，该用户原有登录已失效。请通过私密渠道告知新密码。",
      );
    } catch (e) {
      setPasswordError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const filtered = users.filter(
    (u) =>
      `${u.name} ${u.student_no} ${u.username}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "all" || u.status === filter),
  );
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">OUR ISLANDERS</div>
          <h1>
            小岛成员<span className="title-leaf">✦</span>
          </h1>
          <p>先确认身份，再让同学加入。小岛的安全，一起守护。</p>
        </div>
        <span className="soft-icon">
          <UserRound size={28} />
        </span>
      </div>
      <div className="info-note">
        <ShieldCheck size={20} />
        新注册账号需要审核通过才能登录。管理员只能重置密码，无法查看任何人的原密码。
      </div>
      <div className="panel">
        <div className="workbook-toolbar">
          <div className="segmented">
            {[
              ["all", "全部成员"],
              [
                "pending",
                `待审核 · ${users.filter((u) => u.status === "pending").length}`,
              ],
              ["approved", "已通过"],
              ["rejected", "已停用"],
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="search-box">
            <Search size={17} />
            <input
              aria-label="搜索成员"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="姓名、学号、用户名"
            />
          </div>
          <Button
            type="text"
            aria-label="刷新成员"
            onClick={() => setVersion((v) => v + 1)}
          >
            <RefreshCw size={17} />
          </Button>
        </div>
        <ErrorNotice message={error} />
        {success && (
          <div className="success-notice" role="status">
            {success}
          </div>
        )}
        {loading ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty
            title="这里暂时没有成员"
            description="邀请同学注册，或尝试其他筛选条件。"
          />
        ) : (
          <div className="table-scroll">
            <table className="people-table">
              <thead>
                <tr>
                  <th>同学</th>
                  <th>学号</th>
                  <th>身份</th>
                  <th>账号状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="person">
                        <span className="avatar small">
                          {u.name.slice(0, 1)}
                        </span>
                        <span>
                          <strong>{u.name}</strong>
                          <small>@{u.username}</small>
                        </span>
                      </div>
                    </td>
                    <td>{u.student_no || "—"}</td>
                    <td>{u.role === "admin" ? "超级管理员" : "同学"}</td>
                    <td>
                      <Badge
                        tone={
                          u.status === "approved"
                            ? "green"
                            : u.status === "pending"
                              ? "amber"
                              : "gray"
                        }
                      >
                        {u.status === "approved"
                          ? "已通过"
                          : u.status === "pending"
                            ? "待审核"
                            : "已停用 / 拒绝"}
                      </Badge>
                    </td>
                    <td>
                      <div className="row-actions">
                        {u.role !== "admin" && (
                          <>
                            {u.status !== "approved" && (
                              <Button
                                size="small"
                                type="primary"
                                disabled={busy}
                                icon={<Check size={14} />}
                                onClick={() => status(u, "approved")}
                              >
                                通过
                              </Button>
                            )}
                            {u.status !== "rejected" && (
                              <Button
                                size="small"
                                type="text"
                                danger
                                disabled={busy}
                                onClick={() => status(u, "rejected")}
                              >
                                {u.status === "pending" ? "拒绝" : "停用"}
                              </Button>
                            )}
                            <Button
                              size="small"
                              type="text"
                              disabled={busy}
                              icon={<KeyRound size={14} />}
                              onClick={() => {
                                setReset(u);
                                setPasswordError("");
                              }}
                            >
                              重置密码
                            </Button>
                          </>
                        )}
                        {u.role === "admin" && (
                          <span className="hint">请在账号安全中修改密码</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="workbook-bottom">共 {filtered.length} 位成员</div>
      </div>
      {reset && (
        <Dialog
          title={`重置 ${reset.name} 的密码`}
          onClose={() => {
            if (!busy) {
              setReset(null);
              setPassword("");
            }
          }}
        >
          <form onSubmit={resetPassword}>
            <div className="dialog-body">
              <p className="muted">
                重置后，该账号在所有设备上的登录都会失效。
              </p>
              <label>
                新密码
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                  autoComplete="new-password"
                  placeholder="至少 8 位"
                />
              </label>
              <ErrorNotice message={passwordError} />
            </div>
            <div className="dialog-footer">
              <Button type="primary" htmlType="submit" loading={busy}>
                确认重置
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
