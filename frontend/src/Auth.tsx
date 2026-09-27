import { useState, type FormEvent } from "react";
import { Button } from "animal-island-ui";
import {
  ArrowRight,
  Leaf,
  ShieldCheck,
  FolderHeart,
  Sprout,
} from "lucide-react";
import { api, errorMessage, type User } from "./api";
import { ErrorNotice, Logo } from "./ui";

export function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [form, setForm] = useState({
    username: "",
    password: "",
    name: "",
    student_no: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (register) {
        await api("/auth/register", "POST", form);
        setRegister(false);
        setForm({ ...form, password: "" });
        setSuccess("注册成功！请联系班长审核，审核通过后即可登录。");
      } else {
        const user = await api<User>("/auth/login", "POST", {
          username: form.username,
          password: form.password,
        });
        onLogin(user);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <Logo />
        <div className="auth-copy">
          <div className="eyebrow">
            <Leaf size={16} /> A COZY PLACE FOR YOUR CLASS
          </div>
          <h1>
            小小班级，
            <br />
            好好打理。
          </h1>
          <p>
            从一张问卷，到一份整齐的资料。
            <br />
            把忙碌变简单，让班级生活井井有条。
          </p>
          <div className="auth-illustration">
            <div className="illustration-sun" />
            <div className="paper-card paper-back" />
            <div className="paper-card">
              <span className="paper-leaf">
                <Sprout size={40} />
              </span>
              <b>班级的每一件小事</b>
              <span className="paper-line" />
              <span className="paper-line short" />
              <span className="paper-check">✓ 都值得被认真对待</span>
            </div>
            <div className="illustration-ground" />
            <span className="floating-flower one">✿</span>
            <span className="floating-flower two">✦</span>
          </div>
          <div className="auth-features">
            <span>
              <FolderHeart size={18} />
              资料有归处
            </span>
            <span>
              <ShieldCheck size={18} />
              隐私有守护
            </span>
          </div>
        </div>
        <span className="auth-foot">一起，让班级成为一座温暖的小岛。</span>
      </section>
      <section className="auth-form-side">
        <div className="auth-form-card">
          <span className="auth-kicker">WELCOME TO THE ISLAND</span>
          <h2>{register ? "欢迎新同学上岛" : "欢迎回到小岛"}</h2>
          <p className="muted">
            {register
              ? "认识一下，从你的名字开始。"
              : "你的班级事务，在这里轻松打理。"}
          </p>
          <div className="segmented auth-tabs">
            <button
              className={!register ? "active" : ""}
              disabled={busy}
              onClick={() => {
                setRegister(false);
                setError("");
              }}
            >
              登录小岛
            </button>
            <button
              className={register ? "active" : ""}
              disabled={busy}
              onClick={() => {
                setRegister(true);
                setError("");
              }}
            >
              注册账号
            </button>
          </div>
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              {register && (
                <div className="two-cols">
                  <label>
                    真实姓名
                    <input
                      required
                      value={form.name}
                      maxLength={40}
                      autoComplete="name"
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      placeholder="方便班长认出你"
                    />
                  </label>
                  <label>
                    学号
                    <input
                      required
                      value={form.student_no}
                      maxLength={40}
                      onChange={(e) =>
                        setForm({ ...form, student_no: e.target.value })
                      }
                      placeholder="你的学号"
                    />
                  </label>
                </div>
              )}
              <label>
                用户名
                <input
                  required
                  minLength={3}
                  maxLength={40}
                  pattern="(?:[a-zA-Z0-9_]|-)+"
                  autoComplete="username"
                  value={form.username}
                  onChange={(e) =>
                    setForm({ ...form, username: e.target.value })
                  }
                  placeholder="字母、数字、下划线或短横线"
                />
              </label>
              <label>
                密码
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete={register ? "new-password" : "current-password"}
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  placeholder="至少 8 位，请妥善保管"
                />
              </label>
              <ErrorNotice message={error} />
              {success && (
                <div role="status" className="success-notice">
                  {success}
                </div>
              )}
              <Button
                block
                type="primary"
                size="large"
                htmlType="submit"
                loading={busy}
                icon={<ArrowRight size={18} />}
              >
                {register ? "注册并等待审核" : "进入我的小岛"}
              </Button>
            </fieldset>
          </form>
          <p className="auth-tip">
            <ShieldCheck size={15} />
            {register
              ? "注册后需班长审核，班级资料仅对授权成员开放。"
              : "忘记密码？请联系班长为你重置。"}
          </p>
        </div>
        <div className="auth-footer">
          班级小岛 <span>✦</span> 把每一份资料，安放妥当
        </div>
      </section>
    </div>
  );
}
