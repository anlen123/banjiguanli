import { useState, type FormEvent } from "react";
import { Button } from "animal-island-ui";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  GripVertical,
  CalendarClock,
  Save,
} from "lucide-react";
import {
  api,
  errorMessage,
  newQuestion,
  type Project,
  type ProjectInput,
  type Question,
} from "./api";
import { Dialog, ErrorNotice } from "./ui";

const types: [Question["type"], string][] = [
  ["text", "简答"],
  ["textarea", "长文本"],
  ["number", "数字"],
  ["date", "日期"],
  ["select", "单选"],
  ["file", "文件 / 图片"],
];
function localDate(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function ProjectEditor({
  project,
  onClose,
  onSaved,
}: {
  project?: Project;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProjectInput>(
    project
      ? {
          title: project.title,
          description: project.description,
          deadline: project.deadline,
          published: project.published,
          fields: project.fields,
        }
      : {
          title: "",
          description: "",
          deadline: null,
          published: false,
          fields: [newQuestion()],
        },
  );
  const [deadline, setDeadline] = useState(
    localDate(project?.deadline ?? null),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = !!project?.submission_count;
  const change = (id: string, values: Partial<Question>) =>
    setForm((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === id ? { ...f, ...values } : f)),
    }));
  const move = (index: number, offset: number) =>
    setForm((prev) => {
      const fields = [...prev.fields];
      [fields[index], fields[index + offset]] = [
        fields[index + offset],
        fields[index],
      ];
      return { ...prev, fields };
    });
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        project ? `/projects/${project.id}` : "/projects",
        project ? "PUT" : "POST",
        {
          ...form,
          deadline: deadline ? new Date(deadline).toISOString() : null,
          fields: form.fields.map((f) => ({
            ...f,
            options: f.options.map((x) => x.trim()).filter(Boolean),
          })),
        },
      );
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={project ? "编辑收集项目" : "开启一个新收集"}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form onSubmit={save} className="editor-form">
        <fieldset disabled={busy}>
          <div className="dialog-body">
            <p className="muted">每一次收集，都是一件有条不紊的小事。</p>
            <label>
              项目标题 <em>*</em>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                maxLength={150}
                placeholder="例如：本学期学生信息登记"
              />
            </label>
            <label>
              填写说明
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                maxLength={5000}
                placeholder="告诉同学们需要准备什么，以及这次资料收集的用途。"
                rows={3}
              />
            </label>
            <div className="editor-settings">
              <label>
                <span>
                  <CalendarClock size={16} /> 截止时间（本地时区）
                </span>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </label>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={form.published}
                  onChange={(e) =>
                    setForm({ ...form, published: e.target.checked })
                  }
                />
                <span>
                  发布给同学们<small>关闭后保存为草稿 / 暂停收集</small>
                </span>
              </label>
            </div>
            <p className="hint">
              不设时间则一直开放。截止后学生无法修改，管理员可以修改并延长时间。
            </p>
            <div className="section-line">
              <h3>问卷内容</h3>
              <span>{form.fields.length} / 50 个问题</span>
            </div>
            {locked && (
              <div className="info-note">
                已有填写记录：可以调整标题、说明及截止时间；为保留已有数据，不能删除旧问题、更换题型或删除已有选项。
              </div>
            )}
            {form.fields.map((f, index) => (
              <section className="question-editor" key={f.id}>
                <div className="question-toolbar">
                  <span>
                    <GripVertical size={16} />
                    问题 {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <Button
                      type="text"
                      aria-label={`上移问题 ${index + 1}`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </Button>
                    <Button
                      type="text"
                      aria-label={`下移问题 ${index + 1}`}
                      disabled={index === form.fields.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </Button>
                    <Button
                      type="text"
                      danger
                      aria-label={`删除问题 ${index + 1}`}
                      disabled={
                        form.fields.length === 1 ||
                        (locked && project?.fields.some((x) => x.id === f.id))
                      }
                      onClick={() =>
                        setForm({
                          ...form,
                          fields: form.fields.filter((x) => x.id !== f.id),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
                <div className="question-row">
                  <label>
                    问题标题
                    <input
                      value={f.label}
                      required
                      maxLength={150}
                      onChange={(e) => change(f.id, { label: e.target.value })}
                      placeholder="你想收集什么信息？"
                    />
                  </label>
                  <label>
                    题型
                    <select
                      value={f.type}
                      disabled={
                        locked && project?.fields.some((x) => x.id === f.id)
                      }
                      onChange={(e) =>
                        change(f.id, {
                          type: e.target.value as Question["type"],
                        })
                      }
                    >
                      {types.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {f.type === "select" && (
                  <label>
                    选项（每行一个）
                    <textarea
                      value={f.options.join("\n")}
                      onChange={(e) =>
                        change(f.id, { options: e.target.value.split("\n") })
                      }
                      placeholder={"选项一\n选项二"}
                      rows={3}
                      required
                    />
                  </label>
                )}
                <label>
                  补充说明
                  <input
                    value={f.help}
                    onChange={(e) => change(f.id, { help: e.target.value })}
                    maxLength={500}
                    placeholder={
                      f.type === "file"
                        ? "例如：请上传清晰的 PDF，每个文件不超过 20 MB"
                        : "选填，让问题更容易理解"
                    }
                  />
                </label>
                <label className="checkline">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) =>
                      change(f.id, { required: e.target.checked })
                    }
                  />
                  必填项
                </label>
              </section>
            ))}
            <Button
              block
              type="dashed"
              disabled={form.fields.length >= 50}
              icon={<Plus size={17} />}
              onClick={() =>
                setForm({ ...form, fields: [...form.fields, newQuestion()] })
              }
            >
              添加一个问题
            </Button>
            <ErrorNotice message={error} />
          </div>
          <div className="dialog-footer">
            <span className="hint">
              {form.published ? "保存后同学们即可看到项目" : "草稿仅管理员可见"}
            </span>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={busy}
              icon={<Save size={17} />}
            >
              保存{form.published ? "并发布" : "草稿"}
            </Button>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
