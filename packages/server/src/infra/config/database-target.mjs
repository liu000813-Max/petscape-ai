export function databaseTarget(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch { throw new Error('invalid_database_target'); }
  const schema = url.searchParams.get('schema') || 'public';
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error('invalid_database_target');
  }
  // Schema is used by both qualified Prisma SQL and unqualified raw SQL. Do not
  // add public as a fallback for an isolated miniapp connection.
  if (schema !== 'public') url.searchParams.set('options', `-c search_path=${schema}`);
  return { connectionString: url.href, schema };
}
