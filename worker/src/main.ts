// worker/src/main.ts —— Worker 进程最小启动骨架（WP-2.1）。
// 正式的领取/执行/心跳/写结果逻辑在 WP-3.4 落地。
// 依赖 @petscape/server 验证跨包 workspace 依赖在本骨架下可解析。
import '@petscape/server';

console.log('[worker] PetScape worker process starting (skeleton, WP-2.1)');
