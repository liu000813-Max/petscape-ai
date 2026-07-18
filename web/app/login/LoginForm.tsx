'use client';

// web/app/login/LoginForm.tsx —— 手机号 / 邮箱 + 验证码两步登录的表单状态机（WP-A2 + WP-A3-2）。
// 发送/校验 OTP 直连 Better Auth phone-number / email-otp 插件 REST 端点（见 lib/auth/client.ts）。
// WP-A3-2：邮箱入口启用（复用手机号的两步交互与视觉基准）+ 双账户引导文案。
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import '../components/appshell/app-ui.css';
import {
  sendPhoneOtp,
  verifyPhoneOtp,
  sendEmailOtp,
  signInEmailOtp,
  describeAuthError,
} from '../lib/auth/client';

const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

type Method = 'phone' | 'email';

function formatPhone(phone: string): string {
  return `${phone.slice(0, 3)} ${phone.slice(3, 7)} ${phone.slice(7)}`;
}

function toE164(phone: string): string {
  return `+86${phone}`;
}

export function LoginForm() {
  const router = useRouter();
  const [method, setMethod] = useState<Method>('phone');
  const [step, setStep] = useState<'entry' | 'code'>('entry');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [otpFocused, setOtpFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const otpRef = useRef<HTMLInputElement>(null);

  const phoneValid = PHONE_RE.test(phone);
  const emailValid = EMAIL_RE.test(email.trim());
  const entryValid = method === 'phone' ? phoneValid : emailValid;
  const codeComplete = code.length === OTP_LENGTH;
  // 展示用的目标标识（脱敏排版手机号 / 原始邮箱）。
  const targetLabel = method === 'phone' ? `+86 ${formatPhone(phone)}` : email.trim();

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((s) => s - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const doSend = async () => {
    if (method === 'phone') {
      await sendPhoneOtp(toE164(phone));
    } else {
      await sendEmailOtp(email.trim());
    }
  };

  const sendCode = async () => {
    if (!entryValid || sending) return;
    setSending(true);
    setErrorMessage(null);
    try {
      await doSend();
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
      await doSend();
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
      if (method === 'phone') {
        await verifyPhoneOtp(toE164(phone), code);
      } else {
        await signInEmailOtp(email.trim(), code);
      }
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

  const backToEntry = () => {
    setStep('entry');
    setCode('');
    setErrorMessage(null);
  };

  const switchMethod = (next: Method) => {
    if (next === method) return;
    setMethod(next);
    setStep('entry');
    setCode('');
    setErrorMessage(null);
  };

  if (step === 'entry') {
    return (
      <div className="psx-fade-up" key={`entry-${method}`}>
        <span className="psx-dot-label">登录 / 注册 · 一步完成</span>
        <h1>把想象，打印成家。</h1>
        <p className="psx-login-sub">
          {method === 'phone'
            ? '输入手机号即可继续——新用户验证后自动创建账户。'
            : '输入邮箱即可继续——新用户验证后自动创建账户。'}
        </p>
        <form
          className="psx-login-form"
          onSubmit={(e) => {
            e.preventDefault();
            sendCode();
          }}
        >
          {method === 'phone' ? (
            <>
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
            </>
          ) : (
            <>
              <label className="psx-field-label" htmlFor="psx-email">
                邮箱
              </label>
              <div className="psx-field">
                <input
                  id="psx-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="输入邮箱地址"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
            </>
          )}
          <button type="submit" className="psx-btn-primary" disabled={!entryValid || sending}>
            {sending ? '发送中…' : '获取验证码'}
          </button>
          <div className="psx-divider">或</div>
          <button
            type="button"
            className="psx-btn-ghost"
            onClick={() => switchMethod(method === 'phone' ? 'email' : 'phone')}
          >
            {method === 'phone' ? '邮箱登录' : '手机号登录'}
          </button>
          {errorMessage && (
            <p className="psx-note psx-fade-up" role="alert">
              {errorMessage}
            </p>
          )}
          <p className="psx-note psx-login-hint">
            已有手机号账户？登录后可在账户页绑定邮箱（反之亦然）。
          </p>
        </form>
        <p className="psx-terms">继续即代表你同意 PetScape 的《用户协议》与《隐私政策》。</p>
      </div>
    );
  }

  return (
    <div className="psx-fade-up" key={`code-${method}`}>
      <div className="psx-step-head">
        <button type="button" className="psx-linklike" onClick={backToEntry}>
          <ChevronLeft size={15} strokeWidth={2} />
          {method === 'phone' ? '返回修改手机号' : '返回修改邮箱'}
        </button>
        <span className="psx-dot-label">验证码已发送</span>
      </div>
      <h1>输入验证码</h1>
      <p className="psx-login-sub">6 位数字验证码已发送至 {targetLabel}。</p>
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
            aria-label="验证码"
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
          <span>{method === 'phone' ? '没收到短信？' : '没收到邮件？'}</span>
          <button
            type="button"
            className="psx-linklike"
            onClick={resendCode}
            disabled={countdown > 0 || sending}
          >
            {countdown > 0 ? `重新发送 ${countdown}s` : '重新发送验证码'}
          </button>
        </div>
        <button type="submit" className="psx-btn-primary" disabled={!codeComplete || verifying}>
          {verifying ? '登录中…' : '登录'}
        </button>
        {errorMessage && (
          <p className="psx-note psx-fade-up" role="alert">
            {errorMessage}
          </p>
        )}
      </form>
    </div>
  );
}
