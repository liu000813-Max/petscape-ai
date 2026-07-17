import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { phoneNumber } from "better-auth/plugins";
import { prisma } from "./prisma";
import { sendOtpSms } from "./sms";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? "tracer-dev-secret-not-for-prod",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3100",
  database: prismaAdapter(prisma, {
    provider: "sqlite",
  }),
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber, code }) => {
        const res = await sendOtpSms(phoneNumber, code);
        if (!res.ok) {
          throw new Error(`sendOTP failed via ${res.channel}: ${res.detail}`);
        }
      },
      signUpOnVerification: {
        // create a User on first successful verification, using phone as
        // a synthetic email so the phone number itself is never the PK.
        getTempEmail: (phone) => `${phone}@phone.tracer.local`,
        getTempName: (phone) => phone,
      },
    }),
  ],
});
