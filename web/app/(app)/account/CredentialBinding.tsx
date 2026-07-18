'use client';

// web/app/(app)/account/CredentialBinding.tsx —— 账户页双向凭证绑定（WP-A3-2）。
// 邮箱行 / 手机号行显示已绑･未绑；未绑可发起两步绑定流（发码 → 填码 → 绑定）。
// 绑定成功后**不退出**当前 session，立即 router.refresh() 让账户页显示新凭证
// （e2e 追加断言：绑定响应返回后当前 session 的账户页立即显示新凭证）。
// 冲突（目标凭证已被其他账户占用）内联提示，不退出、不 500。
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  requestEmailChange,
  changeEmail,
  sendPhoneOtp,
  bindPhone,
  describeAuthError,
} from '../../lib/auth/client';

const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_LENGTH = 6;

type Kind = 'email' | 'phone';

function toE164(phone: string): string {
  return `+86${phone}`;
}

export function CredentialBinding({ kind }: { kind: Kind }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'entry' | 'code'>('entry');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const valid = kind === 'phone' ? PHONE_RE.test(value) : EMAIL_RE.test(value.trim());
  const codeComplete = code.length === OTP_LENGTH;
  const label = kind === 'email' ? '邮箱' : '手机号';

  const reset = () => {
    setOpen(false);
    setStep('entry');
    setValue('');
    setCode('');
    setError(null);
  };

  const sendCode = async () => {
    if (!valid || sending) return;
    setSending(true);
    setError(null);
    try {
      if (kind === 'email') {
        // 已登录用户绑定邮箱走 changeEmail 流程：向新邮箱发码。
        await requestEmailChange(value.trim());
      } else {
        await sendPhoneOtp(toE164(value));
      }
      setStep('code');
      setCode('');
      requestAnimationFrame(() => codeRef.current?.focus());
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    if (!codeComplete || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (kind === 'email') {
        await changeEmail(value.trim(), code);
      } else {
        await bindPhone(toE164(value), code);
      }
      // 绑定成功：不退出当前 session，刷新账户页展示新凭证。
      reset();
      router.refresh();
    } catch (err) {
      // 冲突/占用/错码均内联提示，保留当前 session 与输入态。
      setError(describeAuthError(err));
      setCode('');
      codeRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="psx-linklike psx-bind-trigger"
        onClick={() => setOpen(true)}
        data-bind-kind={kind}
      >
        绑定{label}
      </button>
    );
  }

  return (
    <div className="psx-bind-flow psx-fade-up" data-bind-kind={kind}>
      {step === 'entry' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendCode();
          }}
        >
          <div className="psx-field">
            {kind === 'phone' && <span className="psx-field-prefix">+86</span>}
            <input
              type={kind === 'email' ? 'email' : 'tel'}
              inputMode={kind === 'email' ? 'email' : 'numeric'}
              autoComplete={kind === 'email' ? 'email' : 'tel-national'}
              placeholder={kind === 'email' ? '输入要绑定的邮箱' : '输入要绑定的手机号'}
              maxLength={kind === 'phone' ? 11 : undefined}
              value={value}
              aria-label={`绑定${label}`}
              onChange={(e) =>
                setValue(kind === 'phone' ? e.target.value.replace(/\D/g, '').slice(0, 11) : e.target.value)
              }
              autoFocus
            />
          </div>
          <div className="psx-bind-actions">
            <button type="submit" className="psx-btn-primary" disabled={!valid || sending}>
              {sending ? '发送中…' : '获取验证码'}
            </button>
            <button type="button" className="psx-btn-ghost" onClick={reset}>
              取消
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="psx-login-sub">6 位验证码已发送至 {kind === 'phone' ? `+86 ${value}` : value.trim()}。</p>
          <div className="psx-field">
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="输入验证码"
              maxLength={OTP_LENGTH}
              value={code}
              aria-label={`绑定${label}验证码`}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
              autoFocus
            />
          </div>
          <div className="psx-bind-actions">
            <button type="submit" className="psx-btn-primary" disabled={!codeComplete || submitting}>
              {submitting ? '绑定中…' : `确认绑定${label}`}
            </button>
            <button type="button" className="psx-btn-ghost" onClick={() => setStep('entry')}>
              返回
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="psx-note psx-fade-up" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
