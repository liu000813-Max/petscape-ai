'use client';

// web/app/(app)/account/SignOutButton.tsx —— 退出登录（WP-A2）。
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '../../lib/auth/client';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await signOut();
      router.push('/login');
      router.refresh();
    } catch {
      setError('退出登录失败，请稍后重试。');
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" className="psx-btn-ghost" onClick={handleSignOut} disabled={pending}>
        {pending ? '退出中…' : '退出登录'}
      </button>
      {error && <p className="psx-note psx-fade-up" role="alert">{error}</p>}
    </>
  );
}
