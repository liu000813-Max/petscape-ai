// web/app/login/page.tsx —— 登录/注册合一页（WP-A1）。
// 手机号 + 验证码两步；OTP 动作在本包为桩（见 LoginForm 内 TODO），已登录访问则直接进 /account。
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '../lib/auth/session';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: '登录 · PetScape',
};

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect('/account');

  return (
    <div className="psx-root psx-login">
      <div className="psx-login-main">
        <Link className="psx-login-brand" href="/" aria-label="PetScape 首页">
          {/* eslint-disable-next-line @next/next/no-img-element -- 与 landing 同源的静态品牌资产 */}
          <img src="/assets/petscape-logo.png" alt="PetScape" />
        </Link>
        <div className="psx-login-body">
          <LoginForm />
        </div>
      </div>
      <aside className="psx-login-photo" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/scene-cheese-house.jpg" alt="" />
        <span className="psx-photo-caption">为爱宠定制，把想象打印成家。</span>
      </aside>
    </div>
  );
}
