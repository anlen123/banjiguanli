import { useEffect, useState, type FormEvent } from "react";
import { Button } from "animal-island-ui";
import {
  LayoutGrid,
  UsersRound,
  Sparkles,
  LogOut,
  Plus,
  Search,
  SlidersHorizontal,
  FolderOpen,
  CalendarDays,
  ArrowUpRight,
  Pencil,
  CheckCircle2,
  Clock3,
  Leaf,
  ShieldCheck,
  Menu,
  KeyRound,
  ArrowRight,
  X,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  api,
  ApiError,
  dateLabel,
  errorMessage,
  isClosed,
  type Project,
  type User,
} from "./api";
import { Badge, Dialog, Empty, ErrorNotice, Loading, Logo } from "./ui";
import { Auth } from "./Auth";
import { ProjectEditor } from "./ProjectEditor";
import { SubmissionForm } from "./SubmissionForm";
import { Results } from "./Results";
import { People } from "./People";
import { Assistant } from "./Assistant";

function PasswordDialog({
  onClose,
  onLogout,
}: {
  onClose: () => void;
  onLogout: () => void;
}) {
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/auth/password", "PUT", {
        old_password: oldPassword,
        password,
      });
      onLogout();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="账号安全 · 修改密码"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={save}>
        <div className="dialog-body">
          <p className="muted">
            修改后所有设备将退出登录，请使用新密码重新登录。
          </p>
          <label>
            原密码
            <input
              type="password"
              autoComplete="current-password"
              required
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
            />
          </label>
          <label>
            新密码
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位"
            />
          </label>
          <ErrorNotice message={error} />
        </div>
        <div className="dialog-footer">
          <Button type="primary" htmlType="submit" loading={busy}>
            保存新密码
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function IslandBanner({
  user,
  onCreate,
}: {
  user: User;
  onCreate: () => void;
}) {
  return (
    <section className="island-banner">
      <div className="banner-copy">
        <span className="banner-kicker">
          <Leaf size={15} />
          小岛日常 · 每一件小事都有着落
        </span>
        <h2>
          {user.name}，欢迎回到小岛<span> ✦</span>
        </h2>
        <p>
          {user.role === "admin"
            ? "少一点反复催收，多一点从容。\n新学期的资料，就从这里开始整理吧。"
            : "班级需要的资料，都放在这里啦。\n记得在截止前完成填写，提交后还可以修改哦。"}
        </p>
        {user.role === "admin" && (
          <button className="banner-action" onClick={onCreate}>
            发起一次新收集 <ArrowRight size={17} />
          </button>
        )}
      </div>
      <div className="banner-art" aria-hidden="true">
        <span className="art-sun" />
        <span className="art-sparkle">✦</span>
        <div className="art-paper">
          <span className="art-clip" />
          <span className="art-paper-title">CLASS NOTES</span>
          <div>
            <span>✓</span>
            <i />
          </div>
          <div>
            <span>✓</span>
            <i />
          </div>
          <div>
            <span>✓</span>
            <i />
          </div>
          <span className="art-stamp">
            <Leaf size={23} />
          </span>
        </div>
        <div className="art-plant">
          <span />
          <span />
          <span />
          <i />
        </div>
        <span className="art-cloud" />
        <span className="art-ground" />
      </div>
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [page, setPage] = useState("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [editor, setEditor] = useState<Project | "new" | null>(null);
  const [filling, setFilling] = useState<Project | null>(null);
  const [results, setResults] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [, tick] = useState(0);
  const isAdmin = user?.role === "admin";
  useEffect(() => {
    api<User>("/auth/me")
      .then(setUser)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401))
          setBootError(errorMessage(e));
      })
      .finally(() => setBooting(false));
    const expire = () => {
      setUser(null);
      setEditor(null);
      setFilling(null);
      setResults(null);
      setPasswordOpen(false);
      setPage("projects");
    };
    window.addEventListener("session-expired", expire);
    const timer = window.setInterval(() => tick((n) => n + 1), 30000);
    return () => {
      window.removeEventListener("session-expired", expire);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      api<Project[]>("/projects"),
      user.role === "admin" ? api<User[]>("/users") : Promise.resolve([]),
    ])
      .then(([p, u]) => {
        if (active) {
          setProjects(p);
          setMembers(u);
        }
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
  }, [user, version]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const refresh = () => setVersion((v) => v + 1);
  const navigate = (p: string) => {
    setPage(p);
    setResults(null);
    setMobileNav(false);
    setError("");
  };
  async function deleteProject(p: Project) {
    if (
      deleting !== null ||
      !window.confirm(
        `确定永久删除「${p.title}」？所有人的填写信息和本项目的全部附件都会删除，无法恢复。请先导出备份。`,
      )
    )
      return;
    setDeleting(p.id);
    setError("");
    try {
      await api(`/projects/${p.id}`, "DELETE");
      refresh();
      setNotice("项目及其填写资料已删除");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDeleting(null);
    }
  }
  async function logout() {
    try {
      await api("/auth/logout", "POST");
      setUser(null);
      setProjects([]);
      setMembers([]);
      setPage("projects");
      setResults(null);
      setPasswordOpen(false);
      setNotice("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (booting)
    return (
      <div className="boot-screen">
        <Logo />
        <Loading />
      </div>
    );
  if (bootError)
    return (
      <div className="boot-screen">
        <Logo />
        <ErrorNotice message={bootError} />
        <Button onClick={() => location.reload()}>重新连接小岛</Button>
      </div>
    );
  if (!user)
    return (
      <Auth
        onLogin={(u) => {
          setUser(u);
          setProjects([]);
          setMembers([]);
          setPage("projects");
          setError("");
        }}
      />
    );
  const activeProjects = projects.filter((p) => p.published && !isClosed(p));
  const pendingCount = members.filter((u) => u.status === "pending").length;
  const approvedCount = members.filter((u) => u.status === "approved").length;
  const filtered = projects
    .filter(
      (p) =>
        `${p.title} ${p.description}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === "all" ||
          (filter === "active" && p.published && !isClosed(p)) ||
          (filter === "closed" && p.published && isClosed(p)) ||
          (filter === "draft" && !p.published) ||
          (filter === "done" && !!p.my_submitted_at)),
    )
    .sort((a, b) =>
      sort === "deadline"
        ? (a.deadline ? new Date(a.deadline).getTime() : Infinity) -
          (b.deadline ? new Date(b.deadline).getTime() : Infinity)
        : b.id - a.id,
    );
  const totalSubmissions = projects.reduce(
    (sum, p) => sum + (p.submission_count ?? 0),
    0,
  );
  const links = [
    {
      id: "projects",
      label: isAdmin ? "收集项目" : "我的问卷",
      icon: <LayoutGrid size={20} />,
    },
    ...(isAdmin
      ? [
          { id: "people", label: "班级成员", icon: <UsersRound size={20} /> },
          { id: "ai", label: "AI 小助手", icon: <Sparkles size={20} /> },
        ]
      : []),
  ];
  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="sidebar-brand">
          <Logo />
          <button
            className="mobile-close"
            aria-label="关闭导航"
            onClick={() => setMobileNav(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="class-label">
          <span className="class-dot" />
          我们的班级
          <span className="class-role">
            {isAdmin ? "管理空间" : "同学空间"}
          </span>
        </div>
        <div className="nav-caption">小岛工作台</div>
        <nav aria-label="主导航">
          {links.map((l) => (
            <button
              key={l.id}
              className={page === l.id ? "active" : ""}
              onClick={() => navigate(l.id)}
            >
              {l.icon}
              <span>{l.label}</span>
              {l.id === "people" && pendingCount > 0 ? (
                <b className="nav-count">{pendingCount}</b>
              ) : l.id === "ai" ? (
                <span className="new-tag">AI</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span>✿</span>
          <strong>
            事情一件件做，
            <br />
            小岛一天天变好。
          </strong>
          <p>每一份认真，都有回响。</p>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setPasswordOpen(true)}>
            <KeyRound size={18} />
            账号安全
          </button>
          <div className="sidebar-user">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>
                {isAdmin ? "超级管理员" : `学号 ${user.student_no}`}
              </small>
            </div>
            <button aria-label="退出登录" title="退出登录" onClick={logout}>
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="mobile-menu"
              aria-label="打开导航"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              我的小岛<span>/</span>
              <b>
                {page === "projects"
                  ? results
                    ? "填写结果"
                    : "收集项目"
                  : page === "people"
                    ? "班级成员"
                    : "AI 小助手"}
              </b>
            </span>
          </div>
          <div className="topbar-right">
            <span className="today">
              <CalendarDays size={15} />
              {new Date().toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </span>
            <span className="role-pill">
              <ShieldCheck size={14} />
              {isAdmin ? "管理员" : "同学"}
            </span>
            <span className="avatar tiny">{user.name.slice(0, 1)}</span>
          </div>
        </header>
        <main className="main-content">
          {notice && (
            <div className="toast" role="status">
              <CheckCircle2 size={18} />
              {notice}
              <button aria-label="关闭提示" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <ErrorNotice message={error} />
          {page === "people" && isAdmin ? (
            <People onChanged={refresh} />
          ) : page === "ai" && isAdmin ? (
            <Assistant />
          ) : results && isAdmin ? (
            <Results
              project={projects.find((p) => p.id === results.id) ?? results}
              onBack={() => setResults(null)}
              onChanged={refresh}
            />
          ) : (
            <>
              <div className="page-title">
                <div>
                  <div className="eyebrow">A LITTLE ORDER, A LOT OF JOY</div>
                  <h1>
                    {isAdmin ? "班级事务，轻松收好" : "属于你的班级小天地"}
                    <span className="title-leaf">✦</span>
                  </h1>
                  <p>
                    {isAdmin
                      ? "收集、整理、归档，让每一份资料都有自己的位置。"
                      : "一起完成班级的小任务，让每一次收集都更轻松。"}
                  </p>
                </div>
                {isAdmin && (
                  <Button
                    type="primary"
                    icon={<Plus size={18} />}
                    onClick={() => setEditor("new")}
                  >
                    新建收集项目
                  </Button>
                )}
              </div>
              <IslandBanner user={user} onCreate={() => setEditor("new")} />
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-icon mint">
                    <FolderOpen size={24} />
                  </span>
                  <div>
                    <p>全部收集项目</p>
                    <strong>
                      {loading ? "—" : projects.length}
                      <small>个</small>
                    </strong>
                  </div>
                  <span className="stat-decoration">↗</span>
                </div>
                <div className="stat-card">
                  <span className="stat-icon butter">
                    <Clock3 size={24} />
                  </span>
                  <div>
                    <p>正在收集中</p>
                    <strong>
                      {loading ? "—" : activeProjects.length}
                      <small>个</small>
                    </strong>
                  </div>
                  <span className="stat-caption">等候小小的回应</span>
                </div>
                <div className="stat-card">
                  <span className="stat-icon peach">
                    <CheckCircle2 size={24} />
                  </span>
                  <div>
                    <p>{isAdmin ? "累计收到资料" : "我已完成填写"}</p>
                    <strong>
                      {loading
                        ? "—"
                        : isAdmin
                          ? totalSubmissions
                          : projects.filter((p) => p.my_submitted_at).length}
                      <small>份</small>
                    </strong>
                  </div>
                  <span className="stat-caption">每一份都很重要</span>
                </div>
              </div>
              <section className="project-section">
                <div className="section-heading">
                  <h2>
                    <span className="section-mark" />
                    {isAdmin ? "我的收集项目" : "班级收集项目"}
                    <span className="count-pill">{projects.length}</span>
                  </h2>
                  <span className="section-subtitle">
                    把琐碎变有序，把时间留给生活
                  </span>
                </div>
                <div className="project-controls">
                  <div className="segmented">
                    {[
                      ["all", "全部项目"],
                      ["active", "收集中"],
                      ["closed", "已截止"],
                      [
                        isAdmin ? "draft" : "done",
                        isAdmin ? "草稿箱" : "已填写",
                      ],
                    ].map(([value, text]) => (
                      <button
                        key={value}
                        className={filter === value ? "active" : ""}
                        onClick={() => setFilter(value)}
                      >
                        {text}
                        {value === "active" && (
                          <small>{activeProjects.length}</small>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="control-right">
                    <div className="search-box">
                      <Search size={17} />
                      <input
                        aria-label="搜索项目"
                        placeholder="搜索收集项目…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <label className="sort-select">
                      <SlidersHorizontal size={16} />
                      <select
                        aria-label="项目排序"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="newest">最近创建</option>
                        <option value="deadline">截止时间</option>
                      </select>
                    </label>
                    <button
                      className="icon-button"
                      aria-label="刷新项目"
                      onClick={refresh}
                    >
                      <RefreshCw size={17} />
                    </button>
                  </div>
                </div>
                {loading ? (
                  <Loading />
                ) : !filtered.length ? (
                  <div className="panel">
                    <Empty
                      title={
                        query || filter !== "all"
                          ? "没有找到这样的项目"
                          : isAdmin
                            ? "第一份班级收集，从这里开始"
                            : "班长还没有发布收集项目"
                      }
                      description={
                        query || filter !== "all"
                          ? "试试其他关键词或切换筛选条件。"
                          : isAdmin
                            ? "创建问卷、设置截止时间，然后邀请同学们来填写。"
                            : "稍后再来看看，新的班级任务会出现在这里。"
                      }
                    >
                      {isAdmin && !query && filter === "all" && (
                        <Button
                          type="primary"
                          icon={<Plus size={17} />}
                          onClick={() => setEditor("new")}
                        >
                          创建第一个项目
                        </Button>
                      )}
                    </Empty>
                  </div>
                ) : (
                  <div className="project-grid">
                    {filtered.map((p, index) => {
                      const closed = isClosed(p);
                      const progress = approvedCount
                        ? Math.min(
                            100,
                            Math.round(
                              ((p.submission_count ?? 0) / approvedCount) * 100,
                            ),
                          )
                        : 0;
                      return (
                        <article
                          className={`project-card tone-${index % 3}`}
                          key={p.id}
                          style={{
                            animationDelay: `${Math.min(index, 5) * 45}ms`,
                          }}
                        >
                          <div className="project-card-top">
                            <span className="project-icon">
                              <FolderOpen size={25} />
                            </span>
                            <Badge
                              tone={
                                !p.published
                                  ? "gray"
                                  : closed
                                    ? "gray"
                                    : "green"
                              }
                            >
                              {!p.published
                                ? "草稿"
                                : closed
                                  ? "已截止"
                                  : "收集中"}
                            </Badge>
                          </div>
                          <h3>{p.title}</h3>
                          <p className="project-description">
                            {p.description ||
                              "用一份整齐的资料，记录班级的每一件小事。"}
                          </p>
                          <div className="project-meta">
                            <span>
                              <CalendarDays size={14} />
                              {p.deadline
                                ? `${dateLabel(p.deadline)} 截止`
                                : "不设截止时间"}
                            </span>
                            <span>{p.fields.length} 个问题</span>
                          </div>
                          {isAdmin ? (
                            <div className="project-progress">
                              <div>
                                <span>
                                  已收到 <b>{p.submission_count ?? 0}</b> 份资料
                                </span>
                                <small>
                                  班级 {approvedCount} 位成员（含班长）
                                </small>
                              </div>
                              <div className="progress-track">
                                <span style={{ width: `${progress}%` }} />
                              </div>
                            </div>
                          ) : (
                            <div className="student-progress">
                              {p.my_submitted_at ? (
                                <>
                                  <CheckCircle2 size={17} />
                                  <span>
                                    已填写 · {dateLabel(p.my_submitted_at)}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Clock3 size={17} />
                                  <span>
                                    {closed
                                      ? "已截止，未填写"
                                      : "还没有填写，记得及时提交哦"}
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                          {isAdmin && (
                            <div className="admin-personal-actions">
                              <button
                                className="card-open"
                                onClick={() => setFilling(p)}
                              >
                                <Pencil size={15} />
                                {p.my_submitted_at
                                  ? "修改我的资料"
                                  : "填写我的资料"}
                              </button>
                              <button
                                className="delete-project"
                                disabled={deleting !== null}
                                onClick={() => deleteProject(p)}
                              >
                                <Trash2 size={15} />
                                {deleting === p.id ? "删除中…" : "删除项目"}
                              </button>
                            </div>
                          )}
                          <div className="project-card-footer">
                            {isAdmin ? (
                              <>
                                <button
                                  className="card-edit"
                                  onClick={() => setEditor(p)}
                                >
                                  <Pencil size={15} />
                                  编辑问卷
                                </button>
                                <button
                                  className="card-open"
                                  onClick={() => setResults(p)}
                                >
                                  查看资料
                                  <ArrowUpRight size={17} />
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="hint">仅你和管理员可见</span>
                                <button
                                  className="card-open"
                                  onClick={() => setFilling(p)}
                                >
                                  {closed
                                    ? "查看填写"
                                    : p.my_submitted_at
                                      ? "修改填写"
                                      : "去填写"}
                                  <ArrowUpRight size={17} />
                                </button>
                              </>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    {isAdmin && filter === "all" && !query && (
                      <button
                        className="new-project-card"
                        onClick={() => setEditor("new")}
                      >
                        <span>
                          <Plus size={29} />
                        </span>
                        <strong>让下一次收集，也变得简单</strong>
                        <p>新建一个项目，开始新的整理</p>
                      </button>
                    )}
                  </div>
                )}
              </section>
              <div className="bottom-note">
                <Leaf size={14} />
                <span>资料有归处，班级有温度。</span>
                <i />
                班级小岛
              </div>
            </>
          )}
        </main>
      </div>
      {editor && (
        <ProjectEditor
          project={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
            setNotice("收集项目已保存");
          }}
        />
      )}
      {filling && (
        <SubmissionForm
          project={filling}
          admin={isAdmin}
          onWithdrawn={() => {
            setFilling(null);
            refresh();
            setNotice("填写信息已撤回，附件已清理；可重新填写");
          }}
          onClose={() => setFilling(null)}
          onSaved={() => {
            setFilling(null);
            refresh();
            setNotice("资料已提交，截止前可以再次修改");
          }}
        />
      )}
      {passwordOpen && (
        <PasswordDialog
          onClose={() => setPasswordOpen(false)}
          onLogout={() => {
            setPasswordOpen(false);
            setUser(null);
            setPage("projects");
            setResults(null);
          }}
        />
      )}
    </div>
  );
}
