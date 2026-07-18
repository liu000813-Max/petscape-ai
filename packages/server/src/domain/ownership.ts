// domain/ownership.ts —— 归属授权判断（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2 验收 1：
//   "用户 B 访问 A 的项目/资产 404 或 403"。
//
// 领域规则：本模块框架无关，不 import Prisma/next（lint 边界规则），只对已加载的
// 普通对象做归属判断。application 层负责查询数据后调用本模块判断，再决定薄层
// Route Handler 返回 404 还是 403（本包统一选择 404——不向非 owner 泄露资源存在
// 与否，是比 403 更保守的选择，两者均满足验收标准的"404 或 403"）。

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} not found`);
    this.name = 'NotFoundError';
  }
}

/** 判断资源的 ownerUserId 是否等于当前请求用户；不相等则抛 NotFoundError。 */
export function assertOwner(
  resource: { ownerUserId: string } | null | undefined,
  currentUserId: string,
  resourceName: string,
): asserts resource is { ownerUserId: string } {
  if (!resource || resource.ownerUserId !== currentUserId) {
    throw new NotFoundError(resourceName);
  }
}
