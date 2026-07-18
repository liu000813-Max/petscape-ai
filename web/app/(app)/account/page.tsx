// web/app/(app)/account/page.tsx —— 账户页（WP-A2 + WP-A3-2）。
// 当前用户、双向凭证绑定（手机号行 / 邮箱行按登录方式显示已绑/未绑，未绑可发起两步绑定流）、退出登录。
import type { Metadata } from 'next';
import { PawPrint } from 'lucide-react';
import { getSessionUser, maskPhone, maskEmail } from '../../lib/auth/session';
import { SignOutButton } from './SignOutButton';
import { CredentialBinding } from './CredentialBinding';

export const metadata: Metadata = {
  title: '账户 · PetScape',
};

export default async function AccountPage() {
  // 布局已做未登录 302；React cache() 保证与布局共享同一次会话读取。
  const user = await getSessionUser();
  if (!user) return null;

  const phoneMasked = maskPhone(user.phoneNumber);
  const emailMasked = maskEmail(user.email);
  const hasPhone = !!user.phoneNumber;
  const hasEmail = !!user.email;
  // 身份卡主标识：优先手机号（脱敏），否则邮箱（脱敏）。
  const primaryLabel = hasPhone ? phoneMasked : hasEmail ? emailMasked : user.id;
  const primarySub = hasPhone ? '手机号登录 · 已验证' : '邮箱登录 · 已验证';

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
            <div className="psx-identity-name">{primaryLabel}</div>
            <div className="psx-identity-sub">{primarySub}</div>
          </div>
        </div>
      </section>

      <section className="psx-card" aria-label="登录方式">
        <div className="psx-card-title">登录方式</div>

        <div className="psx-row">
          <span className="psx-row-label">手机号</span>
          {hasPhone ? (
            <>
              <span className="psx-row-value">{phoneMasked}</span>
              <span className="psx-tag psx-tag-solid">已绑定</span>
            </>
          ) : (
            <>
              <span className="psx-row-value is-empty">未绑定</span>
              <CredentialBinding kind="phone" />
            </>
          )}
        </div>

        <div className="psx-row">
          <span className="psx-row-label">邮箱</span>
          {hasEmail ? (
            <>
              <span className="psx-row-value">{emailMasked}</span>
              <span className="psx-tag psx-tag-solid">已绑定</span>
            </>
          ) : (
            <>
              <span className="psx-row-value is-empty">未绑定</span>
              <CredentialBinding kind="email" />
            </>
          )}
        </div>

        <p className="psx-footnote psx-bind-hint">
          绑定后，手机号与邮箱都可登录同一个 PetScape 账户。
        </p>
      </section>

      <div className="psx-signout">
        <SignOutButton />
      </div>

      <p className="psx-footnote">ID · {user.id}</p>
    </div>
  );
}
