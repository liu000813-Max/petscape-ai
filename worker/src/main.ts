// worker/src/main.ts —— Worker 进程最小启动骨架（WP-2.1，WP-2.2 接入统一配置入口）。
// 正式的领取/执行/心跳/写结果逻辑在 WP-3.4 落地。
// 依赖 @petscape/server 验证跨包 workspace 依赖在本骨架下可解析。
import { loadWorkerConfig } from '@petscape/server/infra/config';

// 本地开发约定：worker/package.json 的 dev/start 脚本用
// `--env-file=../.env` 指向仓库根目录 `.env`；部署环境由 Compose 直接注入，
// 不依赖 --env-file。配置校验失败会抛出并列出全部缺失/非法键名，
// 让进程 fail-fast 退出（非 0 exit code），不静默带着坏配置继续跑。
const config = loadWorkerConfig();

console.log('[worker] PetScape worker process starting (skeleton, WP-2.1/WP-2.2)');
console.log(`[worker] NODE_ENV=${config.NODE_ENV}, config schema validated OK`);

// WP-2.5：部署链（Docker/Compose healthcheck、重启策略）要求 worker 是
// 常驻进程，而非跑完打印即退出的一次性脚本。真正的领取/执行/心跳循环在
// WP-3.4 落地；本行只是让骨架符合"长驻服务"的容器契约，不引入业务逻辑。
setInterval(() => {}, 1 << 30);

process.on('SIGTERM', () => {
  console.log('[worker] received SIGTERM, shutting down');
  process.exit(0);
});
