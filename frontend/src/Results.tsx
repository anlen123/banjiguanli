import { useEffect, useState } from "react";
import { Button } from "animal-island-ui";
import {
  ArrowLeft,
  Download,
  Search,
  FileText,
  Pencil,
  Table2,
  Users,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import {
  api,
  dateLabel,
  errorMessage,
  type Project,
  type Submission,
  type User,
} from "./api";
import { Badge, Empty, ErrorNotice, Loading } from "./ui";
import { SubmissionForm } from "./SubmissionForm";

export function Results({
  project,
  onBack,
  onChanged,
}: {
  project: Project;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Submission[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("submitted");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(
    null,
  );
  const [version, setVersion] = useState(0);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      api<Submission[]>(`/projects/${project.id}/submissions`),
      api<User[]>("/users"),
    ])
      .then(([r, u]) => {
        if (active) {
          setRows(r);
          setUsers(
            u.filter((x) => x.role === "student" && x.status === "approved"),
          );
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
  }, [project.id, version]);
  const filtered = rows.filter((r) =>
    `${r.name} ${r.student_no} ${Object.values(r.answers)
      .filter((v) => typeof v === "string")
      .join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const missing = users.filter((u) => !rows.some((r) => r.user_id === u.id));
  async function exportExcel() {
    setExporting(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}/export`, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("导出失败，请检查登录状态后重试");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-${project.id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={16} />
        回到收集项目
      </button>
      <div className="page-title">
        <div>
          <div className="eyebrow">COLLECTION WORKBOOK</div>
          <h1>{project.title}</h1>
          <p>每一份填写，一目了然。附件点击即可下载。</p>
        </div>
        <Button
          type="primary"
          icon={<Download size={18} />}
          onClick={exportExcel}
          loading={exporting}
        >
          导出 Excel
        </Button>
      </div>
      <div className="result-summary">
        <span>
          <Table2 size={19} />
          <b>{rows.length}</b> 份已提交
        </span>
        <span>
          <Users size={19} />
          <b>{missing.length}</b> 位待填写
        </span>
        <span>截止：{dateLabel(project.deadline)}</span>
      </div>
      <div className="workbook panel">
        <div className="workbook-toolbar">
          <div className="segmented">
            <button
              className={tab === "submitted" ? "active" : ""}
              onClick={() => setTab("submitted")}
            >
              填写结果
            </button>
            <button
              className={tab === "missing" ? "active" : ""}
              onClick={() => setTab("missing")}
            >
              待填写同学 · {missing.length}
            </button>
          </div>
          <div className="search-box">
            <Search size={17} />
            <input
              aria-label="搜索填写结果"
              placeholder="搜索姓名、学号或答案…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button
            type="text"
            aria-label="刷新填写结果"
            onClick={() => setVersion((v) => v + 1)}
          >
            <RefreshCw size={17} />
          </Button>
        </div>
        <ErrorNotice message={error} />
        {loading ? (
          <Loading />
        ) : tab === "submitted" ? (
          filtered.length ? (
            <div className="table-scroll">
              <table className="spreadsheet">
                <thead>
                  <tr>
                    <th className="row-index">#</th>
                    <th>姓名 / 学号</th>
                    {project.fields.map((f, i) => (
                      <th key={f.id}>
                        <small>{String.fromCharCode(65 + (i % 26))}</small>
                        {f.label}
                      </th>
                    ))}
                    <th>更新时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={r.user_id}>
                      <td className="row-index">{i + 1}</td>
                      <td className="identity-cell">
                        <strong>{r.name}</strong>
                        <small>{r.student_no}</small>
                      </td>
                      {project.fields.map((f) => (
                        <td key={f.id}>
                          {Array.isArray(r.answers[f.id]) ? (
                            <div className="table-files">
                              {(r.answers[f.id] as string[]).map((id) => (
                                <a
                                  key={id}
                                  href={`/api/files/${id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <FileText size={15} />
                                  {r.files[id]?.filename ?? "附件"}
                                </a>
                              ))}
                            </div>
                          ) : (
                            r.answers[f.id] || <span className="muted">—</span>
                          )}
                        </td>
                      ))}
                      <td className="nowrap">{dateLabel(r.updated_at)}</td>
                      <td>
                        <Button
                          size="small"
                          type="text"
                          icon={<Pencil size={15} />}
                          onClick={() =>
                            setEditing({ id: r.user_id, name: r.name })
                          }
                        >
                          编辑
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={search ? "没有找到匹配的资料" : "还没有同学提交"}
              description={
                search
                  ? "换一个关键词试试看。"
                  : "发布项目后，邀请同学们登录小岛填写吧。"
              }
            />
          )
        ) : (
          <div className="missing-list">
            {missing.length ? (
              missing
                .filter((u) => `${u.name} ${u.student_no}`.includes(search))
                .map((u) => (
                  <div key={u.id}>
                    <span className="avatar small">{u.name.slice(0, 1)}</span>
                    <strong>{u.name}</strong>
                    <span className="muted">{u.student_no}</span>
                    <Badge tone="amber">待填写</Badge>
                    <Button
                      size="small"
                      type="text"
                      onClick={() => setEditing({ id: u.id, name: u.name })}
                    >
                      代为填写
                    </Button>
                  </div>
                ))
            ) : (
              <Empty
                title="大家都交齐啦！"
                description="所有已审核的同学都完成了本次收集。"
              >
                <CheckCircle2 size={30} />
              </Empty>
            )}
          </div>
        )}
        <div className="workbook-bottom">
          <span>
            {tab === "submitted"
              ? `共 ${filtered.length} 条记录 · ${project.fields.length} 个收集字段`
              : "仅统计已审核通过的学生"}
          </span>
          <span>仅管理员可见 · 妥善保护同学隐私</span>
        </div>
      </div>
      {editing && (
        <SubmissionForm
          project={project}
          admin
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setVersion((v) => v + 1);
            onChanged();
          }}
        />
      )}
    </>
  );
}
