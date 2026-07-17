import { spawn } from 'child_process';

// 本地可打印性检查（降级方案）。
// 背景：Meshy print/analyze 只吃自家 image-to-3d 的 input_task_id（见 meshy/client.ts
// submitPrintabilityAnalyze），不支持外部 Tripo 产出的 GLB URL/文件。故 gate1 切到 Tripo 后
// 用本地 trimesh 做 watertight / 连通分量 summary。修复暂不做（报告记 TODO）。
// 前台文案仍为「检查可打印性」，不暴露引擎细节。

const PY = `
import sys, json, trimesh
p = sys.argv[1]
try:
    m = trimesh.load(p, force='mesh')
    if m.is_empty:
        print(json.dumps({"error": "empty mesh"})); sys.exit(0)
    try:
        bodies = m.split(only_watertight=False)
        components = len(bodies)
    except Exception:
        components = None
    info = {
        "watertight": bool(m.is_watertight),
        "components": components,
        "vertices": int(len(m.vertices)),
        "faces": int(len(m.faces)),
        "euler_number": int(m.euler_number) if m.euler_number is not None else None,
    }
    print(json.dumps(info))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

export interface LocalPrintability {
  watertight?: boolean;
  components?: number | null;
  vertices?: number;
  faces?: number;
  euler_number?: number | null;
  error?: string;
}

export async function checkPrintabilityLocal(glbAbsPath: string): Promise<LocalPrintability> {
  return new Promise((resolve) => {
    // networkx 提供 trimesh.split 的连通分量图引擎（缺了会 ImportError: no graph engines available）。
    const child = spawn('uv', ['run', '--with', 'trimesh', '--with', 'networkx', 'python', '-c', PY, glbAbsPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => resolve({ error: `spawn uv 失败: ${err.message}` }));
    child.on('close', (code) => {
      const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
      try {
        resolve(JSON.parse(line) as LocalPrintability);
      } catch {
        resolve({ error: `trimesh 检查失败 code=${code}: ${(stderr || stdout).slice(0, 300)}` });
      }
    });
  });
}

export function summarizeLocalPrintability(r: LocalPrintability): string[] {
  if (r.error) return [`check_error=${r.error}`];
  const issues: string[] = [];
  issues.push(`watertight=${String(r.watertight)}`);
  if (r.components !== undefined && r.components !== null) issues.push(`components=${r.components}`);
  if (typeof r.vertices === 'number') issues.push(`vertices=${r.vertices}`);
  if (typeof r.faces === 'number') issues.push(`faces=${r.faces}`);
  if (r.euler_number !== undefined && r.euler_number !== null) issues.push(`euler=${r.euler_number}`);
  return issues;
}

// ---- 混合内核后处理：重网格修水密 → 布尔挖功能腔（椭球内腔 + 圆柱贯通入口）→ 壁厚校验 ----
// 纯本地计算，零外部 API。脚本 scripts/carve_shell.py（移植自已验证管线
// experiments/e2e-pipeline-test/）。入口轴由射线自动探测（front = 中心射线首次命中最深的面）。
// scaleMm 绑定（门2 缩放会破坏 Ø69 物理保证）本切片不解决 —— TODO，见 b31-report.md。

export interface CarveResult {
  watertight?: boolean;
  entranceThrough?: boolean;
  minWallMm?: number | null;
  entranceAxis?: string;
  detail?: unknown;
  error?: string;
}

export interface CarveParams {
  standHeightMm?: number;
  entranceDiameterMm?: number;
  wallMinMm?: number;
}

// 输入原始 GLB + 目标 carved GLB 路径 + JSON 输出路径，spawn carve_shell.py。
// 失败（脚本非零退出 / 无法解析 JSON）返回 { error }，由 gate1 决定回退原始 GLB。
export async function carveShell(
  inGlbAbs: string,
  outGlbAbs: string,
  outJsonAbs: string,
  scriptAbs: string,
  params: CarveParams = {},
): Promise<CarveResult> {
  return new Promise((resolve) => {
    const args = [
      'run',
      '--with', 'pymeshlab',
      '--with', 'manifold3d',
      '--with', 'trimesh',
      '--with', 'fast_simplification',
      '--with', 'numpy',
      '--with', 'rtree',
      '--with', 'networkx',
      'python', scriptAbs,
      inGlbAbs, outGlbAbs, outJsonAbs,
      '--stand-height-mm', String(params.standHeightMm ?? 150),
      '--entrance-diameter-mm', String(params.entranceDiameterMm ?? 69),
      '--wall-min-mm', String(params.wallMinMm ?? 3),
    ];
    const child = spawn('uv', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => resolve({ error: `spawn uv 失败: ${err.message}` }));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ error: `carve_shell 退出码=${code}: ${stderr.slice(-300)}` });
        return;
      }
      const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
      try {
        resolve(JSON.parse(line) as CarveResult);
      } catch {
        resolve({ error: `carve_shell 输出解析失败: ${(stderr || stdout).slice(-300)}` });
      }
    });
  });
}

export function summarizeCarve(r: CarveResult): string[] {
  if (r.error) return [`carve_error=${r.error}`, 'fallback=raw-glb'];
  const issues: string[] = [];
  issues.push(`watertight=${String(r.watertight)}`);
  issues.push(`entranceThrough=${String(r.entranceThrough)}`);
  if (r.minWallMm !== undefined && r.minWallMm !== null) issues.push(`minWallMm=${r.minWallMm}`);
  if (r.entranceAxis) issues.push(`entranceAxis=${r.entranceAxis}`);
  return issues;
}
