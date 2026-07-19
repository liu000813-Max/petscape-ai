type ErrorRecord = Record<string, unknown>;

function asRecord(value: unknown): ErrorRecord | null {
  return typeof value === 'object' && value !== null ? value as ErrorRecord : null;
}

export function isSerializableTransactionConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];

  while (pending.length > 0) {
    const current = pending.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const record = asRecord(current);
    if (!record) continue;

    if (record.code === 'P2034' || record.code === '40001' || record.code === '40P01' ||
        record.originalCode === '40001' || record.originalCode === '40P01' ||
        record.kind === 'TransactionWriteConflict') return true;

    pending.push(record.cause);
    const meta = asRecord(record.meta);
    if (meta) pending.push(meta.driverAdapterError, meta.cause);
  }
  return false;
}

export async function withSerializableTransactionRetry<T>(work: () => Promise<T>, attempts = 5): Promise<T> {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('attempts must be a positive integer');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isSerializableTransactionConflict(error) || attempt === attempts) throw error;
    }
  }
  throw new Error('unreachable serializable retry state');
}
