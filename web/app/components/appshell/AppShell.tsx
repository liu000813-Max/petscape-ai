// web/app/components/appshell/AppShell.tsx —— 登录后区域的布局容器（WP-A1）。
// 顶部导航：品牌 logo /「宠物档案」占位导航项 / 账户入口胶囊。后续应用页复用。
import Link from 'next/link';
import { PawPrint } from 'lucide-react';
import './app-ui.css';

export interface ShellUser {
  phoneMasked: string;
  isPreview: boolean;
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  return (
    <div className="psx-root psx-shell">
      <header className="psx-shell-header">
        <div className="psx-shell-left">
          <Link className="psx-shell-logo" href="/" aria-label="PetScape 首页">
            {/* eslint-disable-next-line @next/next/no-img-element -- 与 landing 同源的静态品牌资产，不走优化管线 */}
            <img src="/assets/petscape-logo.png" alt="PetScape" />
          </Link>
          <nav className="psx-shell-nav" aria-label="主导航">
            {/* 占位导航项：宠物档案模块尚未开放，先立住信息架构位置 */}
            <span className="psx-navitem" aria-disabled="true">
              宠物档案
              <span className="psx-minitag">即将上线</span>
            </span>
          </nav>
        </div>
        <Link className="psx-account-pill" href="/account">
          <span className="psx-circle">
            <PawPrint size={15} strokeWidth={2.2} />
          </span>
          <span>{user.phoneMasked}</span>
        </Link>
      </header>
      <main className="psx-shell-main">{children}</main>
    </div>
  );
}
