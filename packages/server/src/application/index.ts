// application/ —— 用例层。
// WP-3.1：登录用例薄封装（getAuth）落地，见 ./auth.ts。其余业务用例在后续工作包
// （Step 3 其余包）逐步添加。
export { getAuth } from './auth.ts';
export type { GetAuthOptions } from './auth.ts';
