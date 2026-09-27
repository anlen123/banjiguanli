import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "animal-island-ui";
import {
  Sparkles,
  Settings2,
  Send,
  Trash2,
  ShieldCheck,
  ArrowLeft,
  MessageCircle,
} from "lucide-react";
import { api, errorMessage, type AIConfig } from "./api";
import { ErrorNotice, Loading } from "./ui";
type Message = { role: "user" | "assistant"; content: string };

export function Assistant() {
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [settings, setSettings] = useState(false);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    api<AIConfig>("/ai/config")
      .then((c) => {
        if (active) {
          setConfig(c);
          setSettings(!c.has_key);
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
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!config) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api("/ai/config", "PUT", {
        base_url: config.base_url,
        model: config.model,
        api_key: key,
        clear_key: clearKey,
      });
      const updated = await api<AIConfig>("/ai/config");
      setConfig(updated);
      setKey("");
      setClearKey(false);
      setSuccess("配置已保存，密钥已加密存储。");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    const content = draft.trim();
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError("");
    try {
      const result = await api<{ content: string }>("/ai/chat", "POST", {
        messages: next.slice(-29),
      });
      setMessages([...next, { role: "assistant", content: result.content }]);
    } catch (e) {
      setMessages(messages);
      setDraft(content);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">A LITTLE HELP, A LOT LESS WORK</div>
          <h1>
            小岛 AI 助手<span className="title-leaf">✧</span>
          </h1>
          <p>写一份通知，想几个问题，把琐碎留给灵感。</p>
        </div>
        <Button
          icon={settings ? <ArrowLeft size={17} /> : <Settings2 size={17} />}
          disabled={busy}
          onClick={() => {
            setSettings(!settings);
            setError("");
            setSuccess("");
          }}
        >
          {settings ? "返回对话" : "模型配置"}
        </Button>
      </div>
      <ErrorNotice message={error} />
      {loading ? (
        <Loading />
      ) : !config ? (
        <div className="info-note">配置加载失败，请刷新页面重试。</div>
      ) : settings ? (
        <div className="ai-settings panel">
          <div className="section-line">
            <h2>
              <Settings2 size={22} />
              连接你的 AI
            </h2>
            <span className="badge green">OpenAI 兼容</span>
          </div>
          <p className="muted">
            支持 OpenAI 及兼容 Chat Completions
            接口的服务。只发送你输入的对话，不自动读取学生资料。
          </p>
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              <label>
                API Base URL
                <input
                  type="url"
                  required
                  value={config.base_url}
                  onChange={(e) =>
                    setConfig({ ...config, base_url: e.target.value })
                  }
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <p className="hint">
                填写基础地址（通常以 /v1 结尾），不要包含
                /chat/completions。仅支持公网 HTTPS 地址。
              </p>
              <label>
                模型名称
                <input
                  value={config.model}
                  required
                  maxLength={100}
                  onChange={(e) =>
                    setConfig({ ...config, model: e.target.value })
                  }
                  placeholder="gpt-4o-mini"
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  maxLength={500}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    config.has_key
                      ? "已配置，留空保留原密钥"
                      : "输入服务商提供的 API Key"
                  }
                />
              </label>
              {config.has_key && (
                <label className="checkline">
                  <input
                    type="checkbox"
                    checked={clearKey}
                    onChange={(e) => setClearKey(e.target.checked)}
                  />
                  清除已保存的密钥
                </label>
              )}
              <div className="info-note">
                <ShieldCheck size={20} />
                密钥只在后端加密保存，不会回传到浏览器。请勿在聊天中粘贴敏感个人信息。
              </div>
              {success && (
                <div className="success-notice" role="status">
                  {success}
                </div>
              )}
              <Button type="primary" htmlType="submit" loading={busy}>
                保存配置
              </Button>
            </fieldset>
          </form>
        </div>
      ) : (
        <div className="chat-panel panel">
          <div className="chat-top">
            <span className="ai-avatar">
              <Sparkles size={20} />
            </span>
            <div>
              <strong>小岛助手</strong>
              <small>
                {config.model} · {config.has_key ? "已配置" : "尚未配置密钥"}
              </small>
            </div>
            <Button
              type="text"
              disabled={busy || !messages.length}
              aria-label="清空对话"
              onClick={() => {
                if (window.confirm("确定清空本次对话？")) setMessages([]);
              }}
            >
              <Trash2 size={18} />
            </Button>
          </div>
          <div className="chat-messages" aria-live="polite">
            {!messages.length && (
              <div className="chat-welcome">
                <div className="sparkle-orbit">
                  <Sparkles size={40} />
                  <span>✦</span>
                </div>
                <h2>嗨，今天想一起做点什么？</h2>
                <p>
                  我可以帮你起草通知、设计问卷、梳理班级工作。
                  <br />
                  当前版本不读取或操作任何学生附件。
                </p>
                <div className="prompt-chips">
                  {[
                    "写一份温柔的资料提交提醒",
                    "设计一份班级活动意向问卷",
                    "整理班长每周的工作清单",
                  ].map((p) => (
                    <button key={p} onClick={() => setDraft(p)}>
                      <MessageCircle size={16} />
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-message ${m.role}`}>
                <span className="message-author">
                  {m.role === "user" ? "你" : "小岛助手"}
                </span>
                <div>{m.content}</div>
              </div>
            ))}
            {busy && (
              <div className="chat-thinking">
                <Sparkles size={16} className="sway" />
                正在组织语言…
              </div>
            )}
            <div ref={bottom} />
          </div>
          <form className="chat-compose" onSubmit={send}>
            <textarea
              aria-label="发给 AI 的消息"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="和小岛助手聊聊…（Enter 换行）"
              maxLength={12000}
              rows={2}
              disabled={!config.has_key}
            />
            <Button
              type="primary"
              htmlType="submit"
              disabled={!draft.trim() || !config.has_key}
              loading={busy}
              aria-label="发送消息"
            >
              <Send size={20} />
            </Button>
          </form>
          <div className="chat-disclaimer">
            对话会发送给你配置的 AI 服务商 · 不持久化聊天记录 · AI
            内容请核实后使用
          </div>
        </div>
      )}
    </>
  );
}
