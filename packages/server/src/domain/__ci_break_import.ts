// WP-2.4 CI 破坏测试 2/3：违规 import（domain 层禁止依赖 next，临时，验证后删除）
import { NextRequest } from 'next/server';

export function __ciBreakImport(req: NextRequest) {
  return req.url;
}
