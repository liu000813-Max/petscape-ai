// infra/auth/ —— Better Auth 配置工厂（WP-3.1）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.1；收编自 tracer/auth-tracer/app/lib/auth.ts。
//
// ADR-0004：手机号是可验证、可换绑的 credential，不是 User 主键——Better Auth
// 官方 phone-number 插件的模型天然满足这一点（User.id 独立生成，phoneNumber 是
// User 表上可变更的字段，换绑不影响 id）。本模块不读 process.env——调用方
// （web Route Handler）从 loadWebConfig() 取值后显式传入。
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { phoneNumber } from 'better-auth/plugins';
import type { PrismaClient } from '../db/index.ts';
import { sendOtpSms, type SendOtpSmsOptions } from '../sms/index.ts';

export interface CreateAuthOptions {
  prisma: PrismaClient;
  secret: string;
  baseURL?: string;
  smsChannel: 'log' | 'pnvs';
  pnvsCredentials?: SendOtpSmsOptions['pnvsCredentials'];
  pnvsTemplate?: SendOtpSmsOptions['pnvsTemplate'];
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
}: CreateAuthOptions) {
  return betterAuth({
    secret,
    baseURL,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    plugins: [
      phoneNumber({
        sendOTP: async ({ phoneNumber: to, code }) => {
          const res = await sendOtpSms(to, code, {
            channel: smsChannel,
            pnvsCredentials,
            pnvsTemplate,
          });
          if (!res.ok) {
            throw new Error(`sendOTP failed via ${res.channel}: ${res.detail}`);
          }
        },
        signUpOnVerification: {
          // 首次验证成功即创建 User，手机号本身不作为主键（合成邮箱只是 Better Auth
          // 内部占位，业务代码不消费该字段——见 ADR-0004）。
          getTempEmail: (phone) => `${phone}@phone.petscape.local`,
          getTempName: (phone) => phone,
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
