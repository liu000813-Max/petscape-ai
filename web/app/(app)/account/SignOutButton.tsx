'use client';

// web/app/(app)/account/SignOutButton.tsx —— 退出登录（WP-A1 桩）。
import { useState } from 'react';

export function SignOutButton() {
  const [hint, setHint] = useState(false);

  const handleSignOut = () => {
    // TODO(WP-A2)：接 Better Auth signOut（POST /api/auth/sign-out）后跳转 /login。
    setHint(true);
  };

  return (
    <>
      <button type="button" className="psx-btn-ghost" onClick={handleSignOut}>
        退出登录
      </button>
      {hint && <p className="psx-note psx-fade-up">退出登录将在下一工作包接通，当前为界面基线。</p>}
    </>
  );
}
