// infra/auth/ —— Better Auth 配置工厂（WP-3.1 + WP-A3-2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.1；docs/plans/p0-batch-1-execution-plan.md WP-A3-2。
//
// ADR-0004：手机号与邮箱都是可验证、可换绑的 credential，不是 User 主键——Better Auth
// 官方 phone-number / email-otp 插件的模型天然满足这一点（User.id 独立生成，凭证是
// User 表上可变更的字段，换绑不影响 id）。本模块不读 process.env——调用方
// （web Route Handler / application/getAuth）从 loadWebConfig() 取值后显式传入。
//
// WP-A3-2 接线要点：
// - phoneNumber 插件（既有）+ emailOTP 插件（新增，仅 sign-in / change-email 用途）。
// - 两通道发码都过独立节流（infra/otp-throttle）：60s 冷却 + 滚动 24h 10 次上限，
//   成功后才记账；节流拒绝转成 Better Auth API 错误（4xx），不 500。
// - 占位域 `@phone.petscape.local` 在服务端邮箱发码入口拦截：无 OTP 即无法完成
//   sign-in / change-email，从而不能把占位域写成真实注册/绑定邮箱。
// - OTP 存储 storeOTP:'hashed'（DB 只存哈希，不影响发给用户的明文）。
// - changeEmail.enabled=true：已登录（含手机号占位邮箱）用户绑定/迁移真实邮箱走内置
//   原子流程（request-email-change → change-email），事务内校验 OTP + 唯一冲突 + 原地
//   更新 User.email/emailVerified，User.id 不变（选择依据见 PR）。
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { phoneNumber, emailOTP } from 'better-auth/plugins';
import type { PrismaClient } from '../db/index.ts';
import { sendOtpSms, type SendOtpSmsOptions } from '../sms/index.ts';
import { sendOtpEmail, type SendOtpEmailOptions } from '../mail/index.ts';
import { sendThroughThrottle, peekThrottle, OtpThrottledError } from '../otp-throttle/index.ts';
import { assertRealEmail, isPlaceholderEmail, normalizeEmail } from '../../domain/credentials.ts';

export interface CreateAuthOptions {
  prisma: PrismaClient;
  secret: string;
  baseURL?: string;
  smsChannel: 'log' | 'pnvs';
  pnvsCredentials?: SendOtpSmsOptions['pnvsCredentials'];
  pnvsTemplate?: SendOtpSmsOptions['pnvsTemplate'];
  mailChannel: 'log' | 'directmail';
  directMailCredentials?: SendOtpEmailOptions['directMailCredentials'];
  directMailConfig?: SendOtpEmailOptions['directMailConfig'];
}

/** 把节流拒绝映射为 Better Auth 的 4xx API 错误（避免 500，前端可读）。 */
function throttleToApiError(err: unknown): never {
  if (err instanceof OtpThrottledError) {
    const message =
      err.reason === 'cooldown'
        ? '发送太频繁，请稍后再试。'
        : '今日验证码发送次数已达上限，请明天再试。';
    throw new APIError('TOO_MANY_REQUESTS', { message, code: `OTP_${err.reason.toUpperCase()}` });
  }
  throw err;
}

/**
 * 构造本进程的 Better Auth 实例。Web Route Handler 应只调用一次并复用同一实例
 * （避免每次请求重新初始化 adapter/plugin）。
 */
export function createAuth({
  prisma,
  secret,
  baseURL,
  smsChannel,
  pnvsCredentials,
  pnvsTemplate,
  mailChannel,
  directMailCredentials,
  directMailConfig,
}: CreateAuthOptions) {
  return betterAuth({
    secret,
    baseURL,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    // 发码端点前置拦截：占位域拒绝 + 节流只读预检。放在 before-hook 是因为
    // emailOTP/phoneNumber 的 send 回调被 runInBackgroundOrAwait 吞掉异常
    // （见 infra/otp-throttle 注释），回调内抛出的拒绝无法回到 HTTP 响应；
    // before-hook 抛出的 APIError 能正确变成 4xx。真正的原子记账仍在回调里
    // 的 sendThroughThrottle（成功后才记账，是唯一真相源）。
    // 顶层 options.hooks.before 是单个中间件（对每个请求执行），按 ctx.path 分派——
    // 数组形式的 {matcher,handler} 只在 plugin.hooks.before 支持（见 dispatch.mjs getHooks）。
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const path = ctx.path;
        // 邮箱类发码/注册/换绑：占位域拦截（全入口）。
        if (
          path === '/email-otp/send-verification-otp' ||
          path === '/sign-in/email-otp' ||
          path === '/email-otp/request-email-change' ||
          path === '/email-otp/change-email'
        ) {
          const body = ctx.body as { email?: unknown; newEmail?: unknown } | undefined;
          const rawEmail =
            typeof body?.email === 'string'
              ? body.email
              : typeof body?.newEmail === 'string'
                ? body.newEmail
                : undefined;
          if (rawEmail && isPlaceholderEmail(rawEmail)) {
            throw new APIError('BAD_REQUEST', {
              message: '该邮箱不可用于登录或绑定。',
              code: 'INVALID_EMAIL',
            });
          }
          // 已登录绑定路径（request-email-change）的占用冲突前置：目标邮箱已被其他账户占用时
          // 立即返回结构化冲突（4xx EMAIL_EXIST），与手机号侧 PHONE_NUMBER_EXIST 对齐
          // （QA 阻塞项修复；spec 账户语义"拒绝并内联提示"）。放在节流预检之前——否则占用者
          // 自身近期发码会先撞冷却，掩盖真正的冲突原因。防枚举静默只保留在未认证的
          // sign-in 发码入口（send-verification-otp），不在此认证后绑定路径。
          // 竞态兜底照旧：请求时未占用、提交前被抢占的情况由 change-email 的唯一约束 + Better
          // Auth "Email already in use" 4xx 覆盖，本前置只消除"顺序路径用户死路"。
          if (rawEmail && path === '/email-otp/request-email-change') {
            const normalized = normalizeEmail(rawEmail);
            const existing = await prisma.user.findUnique({ where: { email: normalized } });
            if (existing) {
              throw new APIError('CONFLICT', {
                message: '该邮箱已绑定到其他账户，无法重复绑定。',
                code: 'EMAIL_EXIST',
              });
            }
          }
          // 邮件发码类端点做节流只读预检（sign-in / change-email 是消费验证码，不发码，不预检）。
          if (
            rawEmail &&
            (path === '/email-otp/send-verification-otp' || path === '/email-otp/request-email-change')
          ) {
            try {
              await peekThrottle(prisma, normalizeEmail(rawEmail));
            } catch (err) {
              throttleToApiError(err);
            }
          }
        }
        // 手机号发码：节流只读预检。
        if (path === '/phone-number/send-otp') {
          const to = (ctx.body as { phoneNumber?: unknown } | undefined)?.phoneNumber;
          if (typeof to === 'string' && to.length > 0) {
            try {
              await peekThrottle(prisma, to);
            } catch (err) {
              throttleToApiError(err);
            }
          }
        }
      }),
    },
    plugins: [
      phoneNumber({
        sendOTP: async ({ phoneNumber: to, code }) => {
          try {
            await sendThroughThrottle({
              prisma,
              target: to,
              channel: 'sms',
              send: async () => {
                const res = await sendOtpSms(to, code, {
                  channel: smsChannel,
                  pnvsCredentials,
                  pnvsTemplate,
                });
                if (!res.ok) {
                  throw new Error(`sendOTP failed via ${res.channel}: ${res.detail}`);
                }
              },
            });
          } catch (err) {
            throttleToApiError(err);
          }
        },
        signUpOnVerification: {
          // 首次验证成功即创建 User，手机号本身不作为主键（合成邮箱只是 Better Auth
          // 内部占位，业务代码不消费该字段——见 ADR-0004）。
          getTempEmail: (phone) => `${phone}@phone.petscape.local`,
          getTempName: (phone) => phone,
        },
      }),
      emailOTP({
        // DB 只存哈希（不影响发给用户的明文；短 TTL + 节流兜底之外再加一道存储纵深）。
        storeOTP: 'hashed',
        otpLength: 6,
        expiresIn: 300, // 5 分钟
        // 允许注册：未注册邮箱首次 sign-in 即建号（signUp 闭环）。
        disableSignUp: false,
        // 已登录用户换绑/迁移真实邮箱的内置原子流程（request-email-change → change-email）。
        // verifyCurrentEmail=false：手机号占位邮箱用户收不到当前占位邮箱的码，不要求验证当前邮箱。
        changeEmail: { enabled: true, verifyCurrentEmail: false },
        sendVerificationOTP: async ({ email, otp }) => {
          // 占位域全入口拦截：发码前先规范化 + 拒绝占位域（无码即无法 sign-in / change-email）。
          let normalized: string;
          try {
            normalized = assertRealEmail(email);
          } catch {
            throw new APIError('BAD_REQUEST', {
              message: '该邮箱不可用于登录或绑定。',
              code: 'INVALID_EMAIL',
            });
          }
          try {
            await sendThroughThrottle({
              prisma,
              target: normalized,
              channel: 'email',
              send: async () => {
                const res = await sendOtpEmail(normalized, otp, {
                  channel: mailChannel,
                  directMailCredentials,
                  directMailConfig,
                });
                if (!res.ok) {
                  throw new Error(`sendVerificationOTP failed via ${res.channel}: ${res.detail}`);
                }
              },
            });
          } catch (err) {
            throttleToApiError(err);
          }
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
