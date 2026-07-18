# WP-2.0 构建链 tracer 报告

范围：`docs/plans/phase-b-execution-plan.md` WP-2.0（ADR-0001 验证条件 2）。目的是在 Linux 容器里实证 Web/Worker 构建链与重工具层可执行性，不进正式代码。所有产出隔离在本目录，仅按 spec 授权修改了 `web/next.config.ts`（加 `output: 'standalone'`）。

## 环境

- 本机 Docker Desktop（`linux/aarch64` daemon，Apple Silicon）；所有镜像构建显式加 `--platform linux/amd64` 模拟 ECS 实际架构（x86_64）。
- Node 22（容器内 `node:22-bookworm-slim`），pnpm 固定 `10.23.0`（`corepack prepare pnpm@10.23.0 --activate`，与本机 pnpm 版本对齐；容器默认走 corepack 拉取的是 pnpm 11.14，行为有出入，见「踩坑」）。
- Prisma **7.8.0**（`prisma` + `@prisma/client` + `@prisma/adapter-pg` + `@prisma/client-runtime-utils`，均锁 `^7.8.0`），WASM query compiler，无原生 query engine 二进制。
- Web 依赖版本沿用仓库现状：Next 16.2.10、React 19.2.7、TypeScript 6.0.3、sharp 0.34.5。

---

## 验收 1：Web standalone 镜像

**结论：PASS**

- `web/next.config.ts` 加 `output: 'standalone'`（唯一被授权修改的 web 文件）。
- Dockerfile：`tracer/build-tracer/web-image/Dockerfile`（三阶段：deps → build → run，run 阶段只拷贝 `public/`、`.next/standalone`、`.next/static`，非 root 用户）。
- 构建命令：
  ```
  docker build --platform linux/amd64 -f tracer/build-tracer/web-image/Dockerfile -t petscape-web-tracer:latest web
  ```
- `docker build` exit 0；`docker run -d -p 13000:3000 ...` 后容器内探测（容器内无 curl 二进制，slim 镜像默认不带；改用 `docker exec` 内 Node 内置 `http` 客户端对 `localhost:3000` 发请求，语义等价于容器内 curl）：
  ```
  HTTP_STATUS:200
  HAS_PETSCAPE:true
  HAS_TINYHABITAT:true
  ```
  （landing 标识字符串取自 `app/components/landing/Navbar.jsx` 的 `alt="PetScape"` 与 `app/layout.tsx` 的 `title: 'TinyHabitat AI'`。）
- sharp（native addon）、`public/`、`.next/static` 均随 standalone 输出正常工作，未见运行时报错。
- 已知 warning（非阻塞）：Turbopack 构建输出 1 条 NFT（Node File Trace）警告，指向 `app/lib/runtimePublicFile.ts` 里的动态文件路径操作影响了 trace 范围；不影响本次验收，记入 Observations。

## 验收 2：Worker 最小镜像（Prisma 7 + `@prisma/adapter-pg`）

**结论：PASS**

- 目录：`tracer/build-tracer/worker-probe/`，自包含 mini pnpm workspace（`pnpm-workspace.yaml` + 根 `package.json`，未触碰主仓 `web/pnpm-lock.yaml`），单个 package `packages/probe-worker`。
- Dockerfile：`tracer/build-tracer/worker-probe/Dockerfile`（build 阶段 `pnpm install --frozen-lockfile` → `prisma generate` → `pnpm --filter probe-worker deploy --legacy /deploy`；run 阶段只拷贝 `/deploy` 产物，非 root 用户）。
- 构建命令：
  ```
  docker build --platform linux/amd64 \
    --build-arg DATABASE_URL="postgresql://postgres:probe@<pg-host>:5432/probe" \
    -f tracer/build-tracer/worker-probe/Dockerfile \
    -t petscape-worker-tracer:latest \
    tracer/build-tracer/worker-probe
  ```
  （`DATABASE_URL` build-arg 只用于 `prisma generate` 阶段读取 `prisma.config.mjs` 的 `datasource.url`，不连库；运行时通过环境变量传入真实可达地址。）
- 容器运行（连到装了 `postgres:16` 的同 Docker network）：
  ```
  docker run --rm --platform linux/amd64 --network <net> \
    -e DATABASE_URL="postgresql://postgres:probe@<pg-host>:5432/probe" \
    petscape-worker-tracer:latest
  → SELECT_1_RESULT:[{"one":1}]
  → exit 0
  ```
- no-next 断言：
  ```
  docker run --rm --platform linux/amd64 petscape-worker-tracer:latest test ! -d node_modules/next && echo NO-NEXT-OK
  → NO-NEXT-OK
  ```
- **`pnpm deploy` 路径本次跑通**（细节见下方"Worker 制品契约"），未触发 esbuild 备选。

## 验收 3：镜像体积与构建耗时

**结论：PASS（数据见下表）**

体积用 `docker inspect --format '{{.Size}}'`（未压缩，单一 `linux/amd64` 平台层，已排除 buildx 多平台 manifest 导致的 `docker images` 展示膨胀——`docker images` 对同 tag 会把 attestation manifest 一并计入，比实际大 2-3 倍，不采信）与 `docker save | gzip`（压缩态传输近似值）双测。

| 镜像 | 未压缩 | gzip 压缩后 | 备注 |
|---|---:|---:|---|
| `petscape-web-tracer` | 626,458,666 B (~597 MiB) | 625,538,024 B (~596 MiB) | Next standalone + node:22-bookworm-slim base；`public/` 含较多素材使体积偏大 |
| `petscape-worker-tracer` | 167,804,379 B (~160 MiB) | 167,172,033 B (~159 MiB) | `pnpm deploy` 精简依赖树，无 next/react |
| `petscape-slicer-tracer`（重工具层，非验收 1/2 必需但一并记录） | 322,662,307 B (~308 MiB) | 319,318,870 B (~304 MiB) | Debian + GTK3/wx 依赖 + PrusaSlicer 二进制 + uv venv |

构建耗时（`time docker build`，`real`/`total` 列）：

| 镜像 | 冷（`--no-cache`，含镜像层 pull） | 热（无改动重跑，全命中 layer cache） |
|---|---:|---:|
| web | 61.7s | 0.56s |
| worker | 42.6s | 0.30s |
| slicer（重工具层，供参考） | 未单独计冷时；apt 重试问题解决后一次通过构建约 3-4 分钟（含 apt 232 个包 + PrusaSlicer 归档下载，约 128MB apt + 27MB PrusaSlicer） | 4.4s（全缓存） |

未测量项：镜像**拉取**（pull）耗时（ADR-0001 验证条件 2 提到"拉取时间"）——本次只在本机构建+运行，未推送到任何 registry，因此没有真实的跨网络 pull 数据；ACR 拉取耗时留给 WP-2.5（部署链）用真实 ACR 实测补齐。磁盘余量同理留给 WP-2.5 在 ECS 实机上核实。

## 验收 4：PrusaSlicer 容器内切片

**结论：PASS**

- 目录：`tracer/build-tracer/slicer-probe/`；`generate_sample.py` 用 trimesh 自造一个 40×30×20mm 长方体导出 STL（不接业务归一化脚本，只验证 trimesh 库可用）；`minimal_print.ini` 是手写的最小打印参数（喷嘴/床面/温度/密度等），供 CLI 无 GUI 向导直接切片。
- 容器内执行：
  ```
  prusa-slicer sample.stl --export-gcode --load minimal_print.ini -o sample.gcode
  → exit 0
  → sample.gcode 8436 行，6853 条 G1 移动指令，含完整 PrusaSlicer 配置元数据尾注
  ```
- uv + trimesh：`uv venv` + `uv pip install trimesh numpy`，容器内 `python3 generate_sample.py` 正常产出 STL，`mesh.extents == [40.0, 30.0, 20.0]`（符合预期）。

---

## 踩坑与解法（按遭遇顺序）

1. **pnpm 11（corepack 默认版本）阻断 postinstall**：容器内 `corepack enable` 默认拉取的是当前最新 pnpm（11.14.0），比本机 10.23.0 新，对 `sharp`/`@prisma/engines` 等原生构建脚本的策略更严格，即使 `package.json` 声明了 `pnpm.onlyBuiltDependencies` 仍报 `ERR_PNPM_IGNORED_BUILDS`。**解法**：`corepack prepare pnpm@10.23.0 --activate` 固定容器内 pnpm 版本与本机/仓库一致。

2. **Prisma 7 breaking change：schema 里的 `datasource.url` 被移除**：`prisma generate`/`db push` 报 `P1012`，要求把连接串移到 `prisma.config.mjs`（顶层 `datasource.url`，不是我最初以为的 `migrations.url`）。已在 `worker-probe/packages/probe-worker/prisma.config.mjs` + `schema.prisma` 中改用新语法。

3. **默认（无 `output`）的 Prisma 7 Client 生成物在 pnpm 严格隔离下 require 不到 `.prisma/client/default`**：默认生成进 `@prisma/client` 包本体，但其 `default.js` 硬编码 `require('.prisma/client/default')`，该路径在 pnpm 虚拟 store 下从未存在。**解法**：`generator client` 显式加 `output = "../src/generated/prisma"`，把生成物固定到项目内可预期路径；随之发现该路径下的产物又依赖 `@prisma/client-runtime-utils`（未被自动 hoist），补加为显式依赖后解决。

4. **CJS/ESM 互操作**：生成的 Prisma Client 入口是纯 CommonJS（无 `type: module`），Node ESM `import { PrismaClient } from '@prisma/client'` 直接报 named-export 语法错误。改为 `import prismaClientPkg from './generated/prisma/default.js'` + 解构，符合 Prisma 官方 Node-ESM 消费指引。

5. **`pnpm deploy` 在 pnpm 10+ 默认要求 `inject-workspace-packages=true`**：本探针 workspace 内 `probe-worker` 没有跨包依赖，用 `pnpm deploy --legacy <dir>` 绕开（推荐路径是给 injected workspace 场景用的，`--legacy` 对独立包场景更直接、行为与 pnpm 9 一致）。

6. **QEMU/Rosetta 跨架构环境下 `deb.debian.org`（Fastly CDN）纯 HTTP 大文件请求反复被截断**（`500 reading HTTP response body: unexpected EOF`，固定在同一 CDN edge IP，5/5 重试全部复现同一失败模式；小索引文件、HTTPS 请求均不受影响）。**解法**：apt 源切到阿里云镜像（`mirrors.aliyun.com`）+ HTTPS；HTTPS 又引出鸡生蛋问题（验证证书需要 `ca-certificates`，而 `ca-certificates` 本身要走这条 HTTPS 源装），用 `apt-get -o Acquire::https::Verify-Peer=false -o Acquire::https::Verify-Host=false` 临时跳过证书校验完成这一步（仅限本探针镜像构建期间，装的是公开 Debian 包，风险可接受；不建议直接照搬进生产镜像而不重新评估）。这也顺带验证了阿里云镜像源在国内部署场景下的可用性。

7. **PrusaSlicer AppImage 在 glibc 2.36（bookworm）下 `exec` 报 "ELF file ABI version invalid"**：直接用 `ld-linux-x86-64.so.2 <appimage>` 复现确认是 ELF header 的 `EI_ABIVERSION` 字段问题（AppImage 2.9.x/2.8.x 的自解压 stub 采用了非标准值）；`--appimage-extract` 无法使用是因为它本身需要先执行该二进制。且 PrusaSlicer 自 2.8.0 起在 GitHub Releases 只发布 AppImage，不再发布 `.tar.bz2`。**解法**：改用最后一个仍发布 `.tar.bz2` 归档的版本 **2.7.4**，直接 `tar -xjf` 解包，完全绕开 AppImage runtime；额外装 `bzip2`（tar 需要外部 `bzip2` 二进制解压 `.bz2`）。**记入 Observations**：ECS 实际是原生 x86_64（非模拟），部署链（WP-2.5）里 PrusaSlicer 版本选择应重新用真实 ECS 测一次 2.8.1/2.9.x 的 AppImage 是否可正常 exec——本次探针遇到的 ABI 兼容问题不确定是否为 Docker Desktop 模拟层特有，还是 bookworm glibc 的普遍限制；若 ECS 上同样失败，2.7.4 tar.bz2 路径已验证可用，可直接复用。

8. **`--platform linux/amd64` 常量写在 `FROM` 里触发 lint warning**（`FromPlatformFlagConstDisallowed`）：已改为构建时通过 `docker build --platform` 传入，`FROM` 语句本身不再固定平台常量（web 镜像已修正；worker/slicer 镜像本就没有这个写法）。

---

## Worker 制品契约拍定建议（供主控终审）

**建议：`pnpm deploy --legacy`。**

理由：
- 本次实测 `pnpm deploy --legacy` **端到端跑通**：容器内 `pnpm install --frozen-lockfile` → `prisma generate`（自定义 output 路径）→ `pnpm --filter probe-worker deploy --legacy /deploy` 产出的独立目录，`node src/index.js` 直接可执行、真实连库、`SELECT 1` 返回正确结果，且严格不含 `next`。
- 产物体积可控（167MB 未压缩），比 `web` 镜像小近 4 倍，说明 pnpm 的依赖裁剪确实生效（未见明显的"整仓库拖进来"现象）。
- 相比 esbuild bundle：`pnpm deploy` 不需要额外处理 Prisma 的 WASM 二进制资源（`query_compiler_fast_bg.wasm`）、`.node` 原生插件（如未来引入 `pg` 的原生扩展）或动态 `require`/`import()` 路径——这些在 esbuild 打包场景下通常需要手工声明为 external 或用插件处理，维护成本更高。`pnpm deploy` 保留了完整、未打包的 `node_modules` 树，对这类"节点原生资源+WASM 混合依赖"更鲁棒，代价是产物体积比理论最小 bundle 大。
- 唯一摩擦点是 pnpm 10+ 需要显式 `--legacy`（或配置 `inject-workspace-packages`），这是一次性的 workspace 配置决策，不构成长期维护负担。

**未验证的开放问题（留给 WP-2.1/2.3 补齐）**：
- 本探针的 `probe-worker` 不依赖 workspace 内其他包（无 monorepo 内部依赖），因此没有触发 `pnpm deploy` 对 injected workspace packages 的路径（`packages/server` 与 `worker/` 之间如果存在跨包依赖，需要额外验证 `inject-workspace-packages=true` 的非 legacy 路径是否同样干净，或确认继续用 `--legacy` 是否仍然满足未来的跨包依赖场景）。
- 未测量 esbuild 路径的对比数据（因为 `pnpm deploy` 直接跑通，未按 spec "若不通再测 esbuild" 的顺序触发 fallback 测试）；如果主控希望有精确的 bundle 体积/冷启动对比数字再决策，需要额外一轮 esbuild 打包实验。

---

## Observations（spec 之外，未处理）

- `web` Turbopack 构建有 1 条 NFT 警告，指向 `app/lib/runtimePublicFile.ts` 中的动态文件路径操作把整个项目误跟踪进 trace（`app/uploads/[...path]/route.ts` 引入链）。不影响本次构建结果，但值得在 WP-2.1 workspace 落地时关注是否影响 standalone 输出体积或 serverless 部署场景。
- PrusaSlicer 版本选择（2.7.4 tar.bz2）是为绕开本机 Docker Desktop 模拟环境的一个特定兼容性问题；ECS 是原生 x86_64，建议 WP-2.5 或部署验证阶段在真实 ECS 上补测 PrusaSlicer 2.8.1/2.9.x AppImage 是否可以正常运行，以获得面向生产环境的准确版本结论（本报告不代表 ECS 上一定复现同样的 AppImage 问题）。
- `web` 镜像体积（~597 MiB）里 `public/` 静态素材占比未细拆；若未来该目录持续增长，值得在 WP-2.5 前评估是否需要拆分 CDN/OSS 托管而非打进镜像。

---

## 改动文件清单

- `web/next.config.ts`（唯一被 spec 授权的 web 改动：加 `output: 'standalone'`）
- `tracer/build-tracer/web-image/Dockerfile`
- `tracer/build-tracer/worker-probe/`（`pnpm-workspace.yaml`、根 `package.json`、`.dockerignore`、`.gitignore`、`Dockerfile`、`packages/probe-worker/{package.json,prisma.config.mjs,prisma/schema.prisma,src/index.js}`、`pnpm-lock.yaml`）
- `tracer/build-tracer/slicer-probe/`（`Dockerfile`、`generate_sample.py`、`minimal_print.ini`）
- `tracer/build-tracer/REPORT.md`（本文件）
