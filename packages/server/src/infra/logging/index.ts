// infra/logging/ —— 零依赖结构化日志（WP-3.5）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.5。
//
// 基座阶段刻意不引 pino/winston 等第三方日志库（避免新依赖决策，见 spec 补充
// 执行事实）：JSON 行式输出到 stdout，容器日志驱动（json-file）负责落盘/轮转，
// `docker logs | jq` 直接消费。接口设计成未来可换实现——调用方只依赖本模块
// 导出的 `log(...)` 函数与 `LogFields` 类型，不直接拼 JSON.stringify，换成
// pino 等实现时只需替换本文件内部，不动调用点。
//
// 字段集合（均可选，除 ts/level/msg 外）：requestId/userId/projectId/jobId/
// durationMs/err——对应 spec 列出的关联字段。err 统一序列化为
// { message, stack? }，避免 Error 实例被 JSON.stringify 丢弃非 own-enumerable
// 属性（message/stack 在原生 Error 上正是如此）。

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  requestId?: string;
  userId?: string;
  projectId?: string;
  jobId?: string;
  durationMs?: number;
  err?: unknown;
  [key: string]: unknown;
}

interface LogLine {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

function serializeError(err: unknown): { message: string; stack?: string; name?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: typeof err === 'string' ? err : JSON.stringify(err) };
}

/**
 * 输出一条 JSON 行式日志到 stdout。所有字段合并进单一 JSON 对象（不嵌套
 * `fields: {...}`），保证 `docker logs | jq -c .` 逐行可直接解析且字段可直接
 * grep（如 `grep '"requestId":"<uuid>"'`）。
 */
export function log(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const { err, ...rest } = fields;
  const line: LogLine = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...rest,
    ...(err !== undefined ? { err: serializeError(err) } : {}),
  };
  console.log(JSON.stringify(line));
}

export const logInfo = (msg: string, fields?: LogFields): void => log('info', msg, fields);
export const logWarn = (msg: string, fields?: LogFields): void => log('warn', msg, fields);
export const logError = (msg: string, fields?: LogFields): void => log('error', msg, fields);
