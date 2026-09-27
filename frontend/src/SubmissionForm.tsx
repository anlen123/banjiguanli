import { useEffect, useState, type FormEvent } from "react";
import { Button } from "animal-island-ui";
import {
  UploadCloud,
  FileText,
  X,
  LockKeyhole,
  CheckCircle2,
  CalendarDays,
} from "lucide-react";
import {
  api,
  dateLabel,
  errorMessage,
  isClosed,
  type AnswerMap,
  type Attachment,
  type Project,
  type Submission,
} from "./api";
import { Dialog, ErrorNotice, Loading } from "./ui";

export function SubmissionForm({
  project,
  admin = false,
  target,
  onClose,
  onSaved,
}: {
  project: Project;
  admin?: boolean;
  target?: { id: number; name: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [files, setFiles] = useState<Record<string, Attachment>>({});
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<string | null>(null);
  const [, tick] = useState(0);
  const closed = isClosed(project) && !admin;
  const suffix = target ? `?user_id=${target.id}` : "";
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    api<Submission>(`/projects/${project.id}/submission${suffix}`)
      .then((data) => {
        if (active) {
          setAnswers(data.answers);
          setFiles(data.files);
          setUpdated(data.updated_at);
          setLoaded(true);
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
  }, [project.id, suffix]);
  async function upload(fieldId: string, selected: FileList | null) {
    if (!selected?.length) return;
    const existing = Array.isArray(answers[fieldId])
      ? (answers[fieldId] as string[])
      : [];
    if (selected.length + existing.length > 10) {
      setError("每题最多上传 10 个附件");
      return;
    }
    if (Array.from(selected).some((f) => f.size > 20 * 1024 * 1024)) {
      setError("单个文件不能超过 20 MB");
      return;
    }
    setUploading(fieldId);
    setError("");
    try {
      for (const file of Array.from(selected)) {
        const data = new FormData();
        data.append("file", file);
        const uploaded = await api<Attachment>(
          `/projects/${project.id}/files/${fieldId}${suffix}`,
          "POST",
          data,
        );
        setFiles((prev) => ({ ...prev, [uploaded.id]: uploaded }));
        setAnswers((prev) => ({
          ...prev,
          [fieldId]: [
            ...(Array.isArray(prev[fieldId])
              ? (prev[fieldId] as string[])
              : []),
            uploaded.id,
          ],
        }));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading("");
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/projects/${project.id}/submission${suffix}`, "PUT", {
        answers,
      });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      title={target ? `编辑 ${target.name} 的填写信息` : project.title}
      onClose={() => {
        if (!saving && !uploading) onClose();
      }}
      wide
    >
      {loading ? (
        <Loading />
      ) : (
        <form onSubmit={submit}>
          <div className="dialog-body">
            <div className="form-banner">
              <CalendarDays size={20} />
              <span>
                截止时间：{dateLabel(project.deadline)}
                {project.deadline && <small>时间以当前设备时区显示</small>}
              </span>
              {updated && (
                <span className="saved-label">
                  <CheckCircle2 size={16} />
                  已提交
                </span>
              )}
            </div>
            {project.description && (
              <p className="form-description">{project.description}</p>
            )}
            {closed && (
              <div className="info-note">
                <LockKeyhole size={18} />
                收集已截止，当前仅可查看。需要修改时，请联系班长。
              </div>
            )}
            {admin && (
              <p className="hint">
                管理员模式：截止后仍可保存修改。
                {target ? "" : "当前填写将以管理员本人身份提交。"}
              </p>
            )}
            <fieldset disabled={closed || saving || !!uploading || !loaded}>
              {project.fields.map((q, index) => (
                <div className="answer-question" key={q.id}>
                  <label htmlFor={`answer-${q.id}`} className="answer-label">
                    <span className="question-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {q.label}
                    {q.required ? <em>*</em> : <small>选填</small>}
                  </label>
                  {q.help && <p className="hint">{q.help}</p>}
                  {q.type === "file" ? (
                    <>
                      <label className="upload-zone" htmlFor={`answer-${q.id}`}>
                        <UploadCloud size={28} />
                        <strong>
                          {uploading === q.id
                            ? "正在上传，请稍候…"
                            : "选择文件，给资料一个小小的家"}
                        </strong>
                        <span>
                          图片、PDF、Word、Excel、PPT、TXT、CSV、ZIP · 单文件 ≤
                          20 MB · 最多 10 个
                        </span>
                        <input
                          id={`answer-${q.id}`}
                          aria-label={q.label}
                          type="file"
                          multiple
                          accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                          onChange={(e) => {
                            void upload(q.id, e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <div className="attachment-list">
                        {(Array.isArray(answers[q.id])
                          ? (answers[q.id] as string[])
                          : []
                        ).map((id) => (
                          <div className="attachment" key={id}>
                            <FileText size={18} />
                            <a
                              href={`/api/files/${id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {files[id]?.filename ?? "附件"}
                            </a>
                            <small>
                              {((files[id]?.size ?? 0) / 1024).toFixed(1)} KB
                            </small>
                            {!closed && (
                              <Button
                                type="text"
                                aria-label={`移除 ${files[id]?.filename}`}
                                onClick={() =>
                                  setAnswers((prev) => ({
                                    ...prev,
                                    [q.id]: (prev[q.id] as string[]).filter(
                                      (x) => x !== id,
                                    ),
                                  }))
                                }
                              >
                                <X size={16} />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : q.type === "textarea" ? (
                    <textarea
                      id={`answer-${q.id}`}
                      value={String(answers[q.id] ?? "")}
                      onChange={(e) =>
                        setAnswers({ ...answers, [q.id]: e.target.value })
                      }
                      rows={4}
                      required={q.required}
                      maxLength={10000}
                      placeholder="在这里写下你的答案…"
                    />
                  ) : q.type === "select" ? (
                    <select
                      id={`answer-${q.id}`}
                      value={String(answers[q.id] ?? "")}
                      onChange={(e) =>
                        setAnswers({ ...answers, [q.id]: e.target.value })
                      }
                      required={q.required}
                    >
                      <option value="">请选择</option>
                      {q.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`answer-${q.id}`}
                      type={q.type}
                      step={q.type === "number" ? "any" : undefined}
                      value={String(answers[q.id] ?? "")}
                      onChange={(e) =>
                        setAnswers({ ...answers, [q.id]: e.target.value })
                      }
                      required={q.required}
                      maxLength={10000}
                      placeholder="请填写"
                    />
                  )}
                </div>
              ))}
            </fieldset>
            <ErrorNotice message={error} />
            {updated && <p className="hint">上次保存：{dateLabel(updated)}</p>}
          </div>
          <div className="dialog-footer">
            <span className="hint">
              {closed ? "你的资料已妥善保管" : "附件上传后，请记得保存提交"}
            </span>
            <Button disabled={saving || !!uploading} onClick={onClose}>
              关闭
            </Button>
            {!closed && (
              <Button
                type="primary"
                htmlType="submit"
                loading={saving}
                disabled={!!uploading || !loaded}
                icon={<CheckCircle2 size={17} />}
              >
                {updated ? "保存修改" : "提交资料"}
              </Button>
            )}
          </div>
        </form>
      )}
    </Dialog>
  );
}
