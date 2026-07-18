// web/app/(app)/account/page.tsx —— 账户页（WP-A2）。
// 当前用户（脱敏手机号）、已绑定凭证列表（手机号已绑 / 邮箱未绑占位）、退出登录。
import type { Metadata } from 'next';
import { PawPrint } from 'lucide-react';
import { getSessionUser, maskPhone } from '../../lib/auth/session';
import { SignOutButton } from './SignOutButton';

export const metadata: Metadata = {
  title: '账户 · PetScape',
};

export default async function AccountPage() {
  // 布局已做未登录 302；React cache() 保证与布局共享同一次会话读取。
  const user = await getSessionUser();
  if (!user) return null;

  const phoneMasked = maskPhone(user.phoneNumber);

  return (
    <div className="psx-page psx-fade-up">
      <span className="psx-dot-label">我的 PetScape</span>
      <h1 className="psx-page-title">账户</h1>

      <section className="psx-card" aria-label="当前登录">
        <div className="psx-identity">
          <span className="psx-circle">
            <PawPrint size={19} strokeWidth={2.1} />
          </span>
          <div>
            <div className="psx-identity-name">{phoneMasked}</div>
            <div className="psx-identity-sub">手机号登录 · 已验证</div>
          </div>
        </div>
      </section>

      <section className="psx-card" aria-label="登录方式">
        <div className="psx-card-title">登录方式</div>
        <div className="psx-row">
          <span className="psx-row-label">手机号</span>
          <span className="psx-row-value">{phoneMasked}</span>
          <span className="psx-tag psx-tag-solid">已绑定</span>
        </div>
        <div className="psx-row">
          <span className="psx-row-label">邮箱</span>
          <span className="psx-row-value is-empty">未绑定</span>
          <span className="psx-tag psx-tag-soft">即将开放</span>
        </div>
      </section>

      <div className="psx-signout">
        <SignOutButton />
      </div>

      <p className="psx-footnote">ID · {user.id}</p>
    </div>
  );
}
