// web/app/lib/auth/ —— Web 进程侧的身份装配胶水层（WP-3.1）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.1。
//
// 只做两件事：1) 读已校验的 WebConfig；2) 调用 @petscape/server 的 getAuth() 用例
// 拿到 Better Auth 实例。不包含任何身份业务逻辑（那些在 packages/server 的
// application/infra 层）——Route Handler 是薄层，这里也是薄层。
//
// 懒初始化：`next build` 会在构建期静态收集各 Route Handler 的页面数据，若在模块
// 顶层立即执行 getAuth()/loadWebConfig()，构建环境缺少 DATABASE_URL（CI 无 RDS
// 内网访问）时会直接构建失败。改为函数内懒加载 + 缓存，只在真正处理请求时才要求
// 配置齐全，构建期不触发。
import { loadWebConfig } from '@petscape/server/infra/config';
import { getAuth } from '@petscape/server/application';

let cachedAuth: ReturnType<typeof getAuth> | undefined;

export function getWebAuth(): ReturnType<typeof getAuth> {
  if (!cachedAuth) {
    cachedAuth = getAuth({ config: loadWebConfig() });
  }
  return cachedAuth;
}
