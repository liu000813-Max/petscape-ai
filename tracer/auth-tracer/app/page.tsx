export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: 24 }}>
      <h1>auth-tracer</h1>
      <p>Better Auth + phone-number + Prisma(SQLite) compatibility tracer.</p>
      <p>Login loop is exercised via scripts/login-loop.mjs (curl-equivalent).</p>
    </main>
  );
}
