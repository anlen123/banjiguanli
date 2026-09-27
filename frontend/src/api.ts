export type User = {
  id: number;
  username: string;
  name: string;
  student_no: string;
  role: "admin" | "student";
  status: "pending" | "approved" | "rejected";
  created_at: string;
};
export type Question = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select" | "file";
  required: boolean;
  help: string;
  options: string[];
};
export type Project = {
  id: number;
  title: string;
  description: string;
  deadline: string | null;
  published: boolean;
  fields: Question[];
  expired: boolean;
  created_at: string;
  submission_count?: number;
  my_submitted_at?: string | null;
};
export type ProjectInput = Pick<
  Project,
  "title" | "description" | "deadline" | "published" | "fields"
>;
export type Attachment = { id: string; filename: string; size: number };
export type AnswerMap = Record<string, string | string[]>;
export type Submission = {
  user_id: number;
  name: string;
  student_no: string;
  answers: AnswerMap;
  files: Record<string, Attachment>;
  updated_at: string | null;
};
export type AIConfig = { base_url: string; model: string; has_key: boolean };
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const isFile = body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      "X-Requested-With": "class-island",
      ...(!isFile && body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body === undefined ? undefined : isFile ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = "请求失败，请稍后重试";
    try {
      const data = await response.json();
      message =
        typeof data.detail === "string"
          ? data.detail
          : Array.isArray(data.detail)
            ? data.detail.map((x: { msg: string }) => x.msg).join("；")
            : message;
    } catch {
      /* A reverse proxy may return a non-JSON error. */
    }
    if (
      response.status === 401 &&
      path !== "/auth/login" &&
      path !== "/auth/me"
    )
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}
export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请重试";
export const dateLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "不限时间";
export const isClosed = (p: Project) =>
  !!p.deadline && new Date(p.deadline).getTime() <= Date.now();
export const newQuestion = (): Question => ({
  id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
  label: "",
  type: "text",
  required: false,
  help: "",
  options: [],
});
