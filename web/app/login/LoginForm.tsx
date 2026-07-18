'use client';

// web/app/login/LoginForm.tsx —— 手机号 + 验证码两步登录的表单状态机（WP-A2）。
// 发送/校验 OTP 直连 Better Auth phone-number 插件 REST 端点（见 lib/auth/client.ts）。
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import '../components/appshell/app-ui.css';
import { sendPhoneOtp, verifyPhoneOtp, describeAuthError } from '../lib/auth/client';

const PHONE_RE = /^1[3-9]\d{9}$/;
const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

function formatPhone(phone: string): string {
  return `${phone.slice(0, 3)} ${phone.slice(3, 7)} ${phone.slice(7)}`;
}

function toE164(phone: string): string {
  return `+86${phone}`;
}

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [otpFocused, setOtpFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const otpRef = useRef<HTMLInputElement>(null);

  const phoneValid = PHONE_RE.test(phone);
  const codeComplete = code.length === OTP_LENGTH;

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const sendCode = async () => {
    if (!phoneValid || sending) return;
    setSending(true);
    setErrorMessage(null);
    try {
      await sendPhoneOtp(toE164(phone));
      setStep('code');
      setCode('');
      setCountdown(RESEND_SECONDS);
      requestAnimationFrame(() => otpRef.current?.focus());
    } catch (err) {
      setErrorMessage(describeAuthError(err));
    } finally {
      setSending(false);
    }
  };

  const resendCode = async () => {
    if (countdown > 0 || sending) return;
    setSending(true);
    setErrorMessage(null);
    try {
      await sendPhoneOtp(toE164(phone));
      setCountdown(RESEND_SECONDS);
      otpRef.current?.focus();
    } catch (err) {
      setErrorMessage(describeAuthError(err));
    } finally {
      setSending(false);
    }
  };

  const submitCode = async () => {
    if (!codeComplete || verifying) return;
    setVerifying(true);
    setErrorMessage(null);
    try {
      await verifyPhoneOtp(toE164(phone), code);
      router.push('/account');
      router.refresh();
    } catch (err) {
      setErrorMessage(describeAuthError(err));
      setCode('');
      otpRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const backToPhone = () => {
    setStep('phone');
    setCode('');
    setErrorMessage(null);
  };

  if (step === 'phone') {
    return (
      <div className="psx-fade-up" key="phone">
        <span className="psx-dot-label">登录 / 注册 · 一步完成</span>
        <h1>把想象，打印成家。</h1>
        <p className="psx-login-sub">输入手机号即可继续——新用户验证后自动创建账户。</p>
        <form
          className="psx-login-form"
          onSubmit={(e) => {
            e.preventDefault();
            sendCode();
          }}
        >
          <label className="psx-field-label" htmlFor="psx-phone">
            手机号
          </label>
          <div className="psx-field">
            <span className="psx-field-prefix">+86</span>
            <input
              id="psx-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="输入 11 位手机号"
              maxLength={11}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
              autoFocus
            />
          </div>
          <button type="submit" className="psx-btn-primary" disabled={!phoneValid || sending}>
            {sending ? '发送中…' : '获取验证码'}
          </button>
          <div className="psx-divider">或</div>
          <button
            type="button"
            className="psx-btn-ghost psx-email-stub"
            aria-disabled="true"
            title="邮箱登录即将开放"
            onClick={(e) => e.preventDefault()}
          >
            <span>邮箱登录</span>
            <span className="psx-tag psx-tag-soft">即将开放</span>
          </button>
          {errorMessage && <p className="psx-note psx-fade-up" role="alert">{errorMessage}</p>}
        </form>
        <p className="psx-terms">继续即代表你同意 PetScape 的《用户协议》与《隐私政策》。</p>
      </div>
    );
  }

  return (
    <div className="psx-fade-up" key="code">
      <div className="psx-step-head">
        <button type="button" className="psx-linklike" onClick={backToPhone}>
          <ChevronLeft size={15} strokeWidth={2} />
          返回修改手机号
        </button>
        <span className="psx-dot-label">验证码已发送</span>
      </div>
      <h1>输入验证码</h1>
      <p className="psx-login-sub">6 位数字验证码已发送至 +86 {formatPhone(phone)}。</p>
      <form
        className="psx-login-form"
        onSubmit={(e) => {
          e.preventDefault();
          submitCode();
        }}
      >
        <div className="psx-otp" onClick={() => otpRef.current?.focus()}>
          <input
            ref={otpRef}
            className="psx-otp-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={OTP_LENGTH}
            value={code}
            aria-label="短信验证码"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
            onFocus={() => setOtpFocused(true)}
            onBlur={() => setOtpFocused(false)}
          />
          {Array.from({ length: OTP_LENGTH }).map((_, i) => {
            const active = otpFocused && i === Math.min(code.length, OTP_LENGTH - 1);
            return (
              <div key={i} className={`psx-otp-box${active ? ' is-active' : ''}`} aria-hidden="true">
                {code[i] ?? (active ? <span className="psx-otp-caret" /> : '')}
              </div>
            );
          })}
        </div>
        <div className="psx-otp-meta">
          <span>没收到短信？</span>
          <button type="button" className="psx-linklike" onClick={resendCode} disabled={countdown > 0 || sending}>
            {countdown > 0 ? `重新发送 ${countdown}s` : '重新发送验证码'}
          </button>
        </div>
        <button type="submit" className="psx-btn-primary" disabled={!codeComplete || verifying}>
          {verifying ? '登录中…' : '登录'}
        </button>
        {errorMessage && (
          <p className="psx-note psx-fade-up" role="alert">{errorMessage}</p>
        )}
      </form>
    </div>
  );
}
