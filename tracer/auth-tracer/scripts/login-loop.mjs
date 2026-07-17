// End-to-end phone-OTP login loop against a running server.
// Layer 1: reads the OTP from the server log (SMS_CHANNEL=log prints it).
// Usage: node scripts/login-loop.mjs <baseUrl> <phone> <serverLogPath>
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3100";
const phone = process.argv[3] ?? "+8613800138000";
const logPath = process.argv[4] ?? "logs/server.log";

const jar = new Map();
function saveCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function step(name, path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base,
      cookie: cookieHeader(),
    },
    body: JSON.stringify(body),
  });
  saveCookies(res);
  const text = await res.text();
  console.log(`[${name}] status=${res.status} body=${text.slice(0, 300)}`);
  return { status: res.status, text };
}

function extractCode() {
  // Read the last "OTP for <phone> => <code>" line from the server log.
  const log = readFileSync(logPath, "utf8");
  const lines = log.split("\n").filter((l) => l.includes("[SMS:log] OTP for"));
  const last = lines.at(-1);
  if (!last) throw new Error("no OTP line found in server log");
  const m = last.match(/=>\s*([A-Za-z0-9]+)\s*$/);
  if (!m) throw new Error(`could not parse code from: ${last}`);
  return m[1];
}

async function main() {
  console.log(`=== login loop: base=${base} phone=${phone} ===`);

  // 1. send OTP
  const send = await step("send-otp", "/api/auth/phone-number/send-otp", {
    phoneNumber: phone,
  });
  if (send.status !== 200) throw new Error("send-otp failed");

  // small wait so the log line is flushed
  await new Promise((r) => setTimeout(r, 400));
  const code = extractCode();
  console.log(`[extracted-code] ${code}`);

  // 2. verify OTP -> establishes session cookie
  const verify = await step("verify", "/api/auth/phone-number/verify", {
    phoneNumber: phone,
    code,
  });
  if (verify.status !== 200) throw new Error("verify failed");

  // 3. hit protected route with the session cookie
  const prot = await fetch(base + "/api/protected", {
    headers: { cookie: cookieHeader() },
  });
  const protBody = await prot.text();
  console.log(`[protected] status=${prot.status} body=${protBody}`);

  if (prot.status !== 200) throw new Error("protected route did not authenticate");
  const parsed = JSON.parse(protBody);
  if (!parsed.authenticated || !parsed.user?.id) {
    throw new Error("protected route returned no authenticated user");
  }
  console.log(`\nLOGIN-LOOP-OK user.id=${parsed.user.id} phone=${parsed.user.phoneNumber}`);
}

main().catch((e) => {
  console.error("LOGIN-LOOP-FAIL", e.message);
  process.exit(1);
});
