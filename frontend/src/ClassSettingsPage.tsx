import { useState, type FormEvent } from "react";
import { Button } from "animal-island-ui";
import { School, UserRound, Save } from "lucide-react";
import { api, errorMessage, type ClassSettings, type User } from "./api";
import { ErrorNotice } from "./ui";

export function ClassSettingsPage({
  user,
  settings,
  onClassSaved,
  onProfileSaved,
}: {
  user: User;
  settings: ClassSettings;
  onClassSaved: (settings: ClassSettings) => void;
  onProfileSaved: (user: User) => void;
}) {
  const [className, setClassName] = useState(settings.class_name);
  const [name, setName] = useState(user.name);
  const [studentNo, setStudentNo] = useState(user.student_no);
  const [classBusy, setClassBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [classError, setClassError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [classMessage, setClassMessage] = useState("");
  const [profileMessage, setProfileMessage] = useState("");

  async function saveClass(e: FormEvent) {
    e.preventDefault();
    setClassBusy(true);
    setClassError("");
    setClassMessage("");
    try {
      const result = await api<ClassSettings>("/class-settings", "PUT", {
        class_name: className,
      });
      setClassName(result.class_name);
      onClassSaved(result);
      setClassMessage("班级名称已保存，后续导出将使用新的名称前缀。");
    } catch (e) {
      setClassError(errorMessage(e));
    } finally {
      setClassBusy(false);
    }
  }
  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileBusy(true);
    setProfileError("");
    setProfileMessage("");
    try {
      const result = await api<User>("/admin/profile", "PUT", {
        name,
        student_no: studentNo,
      });
      setName(result.name);
      setStudentNo(result.student_no);
      onProfileSaved(result);
      setProfileMessage(
        "个人资料已保存，填写记录与导出的姓名、学号列已同步更新。",
      );
    } catch (e) {
      setProfileError(errorMessage(e));
    } finally {
      setProfileBusy(false);
    }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">MAKE THIS ISLAND YOUR OWN</div>
          <h1>
            班级设置<span className="title-leaf">✦</span>
          </h1>
          <p>给小岛一个名字，也让每一份资料找到真实的主人。</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel settings-card">
          <h2>
            <School size={22} />
            我们的班级
          </h2>
          <p className="muted">
            所有成员都能看到班级名称，只有管理员可以修改。
          </p>
          <form onSubmit={saveClass}>
            <fieldset disabled={classBusy}>
              <label>
                班级名称
                <input
                  required
                  minLength={1}
                  maxLength={80}
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  placeholder="例如：2026 级计算机一班"
                />
              </label>
              <div className="info-note">
                导出命名：班级名称_项目名称.xlsx
                <br />
                ZIP 和其中的 Excel
                也使用相同名称。文件名中的特殊字符会安全替换，超长名称会缩短。
              </div>
              <ErrorNotice message={classError} />
              {classMessage && (
                <div className="success-notice" role="status">
                  {classMessage}
                </div>
              )}
              <Button
                type="primary"
                htmlType="submit"
                loading={classBusy}
                icon={<Save size={16} />}
              >
                保存班级名称
              </Button>
            </fieldset>
          </form>
        </section>
        <section className="panel settings-card">
          <h2>
            <UserRound size={22} />
            我的管理员资料
          </h2>
          <p className="muted">
            当前登录账号：@{user.username}
            。这里修改真实姓名，不更改登录用户名、密码或管理员身份。
          </p>
          <form onSubmit={saveProfile}>
            <fieldset disabled={profileBusy}>
              <label>
                我的真实姓名
                <input
                  required
                  minLength={1}
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="请输入你自己的姓名"
                />
              </label>
              <label>
                我的学号（选填）
                <input
                  maxLength={40}
                  value={studentNo}
                  onChange={(e) => setStudentNo(e.target.value)}
                  placeholder="管理员也可以填写自己的学号"
                />
              </label>
              <div className="info-note">
                会同步更新侧栏、填写人及导出的姓名 /
                学号列，包括历史提交。问卷里手动输入的答案不会被自动替换，需要在「修改我的资料」中自行调整。
              </div>
              <ErrorNotice message={profileError} />
              {profileMessage && (
                <div className="success-notice" role="status">
                  {profileMessage}
                </div>
              )}
              <Button
                type="primary"
                htmlType="submit"
                loading={profileBusy}
                icon={<Save size={16} />}
              >
                保存我的资料
              </Button>
            </fieldset>
          </form>
        </section>
      </div>
    </>
  );
}
