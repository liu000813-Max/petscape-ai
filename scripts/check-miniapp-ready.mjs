// Local configuration diagnostics only. Never writes configuration or contacts WeChat.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import vm from 'node:vm';

async function optionalFile(filename) {
  try { return await readFile(filename, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function clientContains(directory, secret) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory() && await clientContains(filename, secret)) return true;
    if (entry.isFile() && /\.(js|json|wxml|wxss)$/u.test(entry.name) && (await readFile(filename, 'utf8')).includes(secret)) return true;
  }
  return false;
}

function onlineOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && value === url.origin && url.hostname.includes('.')
      && !/^(localhost|127\.)/u.test(url.hostname) && !url.hostname.endsWith('.invalid');
  } catch { return false; }
}

export async function checkMiniappReady(root, environment = process.env) {
  const checks = [];
  const check = (id, ok, pass, fail) => checks.push({ id, status: ok ? 'pass' : 'missing', message: ok ? pass : fail });
  const externalVerification = [
    '注册账号并核对个人主体实际可选类目和内容范围',
    '微信后台配置 request 合法域名并验证正式后端',
    '本人登录开发者工具，完成 wx.login、真机和隐私授权验收',
    '上传体验版、设置体验成员并验证微信体验二维码',
  ];
  try {
    const clientRoot = path.join(root, 'miniapp');
    const clientModule = { exports: {} };
    vm.runInNewContext(await readFile(path.join(clientRoot, 'utils/config.js'), 'utf8'), { module: clientModule }, { timeout: 1000 });
    const config = clientModule.exports;
    const project = JSON.parse(await readFile(path.join(clientRoot, 'project.config.json'), 'utf8'));
    const privateText = await optionalFile(path.join(clientRoot, 'project.private.config.json'));
    const privateProject = privateText === null ? {} : JSON.parse(privateText);
    const localEnv = parseEnv(await optionalFile(path.join(root, '.env')) || '');
    const env = { ...localEnv, ...environment };
    const appId = project.appid;
    const secret = env.WECHAT_MINIPROGRAM_APP_SECRET;
    const realId = typeof appId === 'string' && /^wx[0-9a-f]{16}$/iu.test(appId);
    check('appid', realId, '客户端 AppID 格式有效；不证明账号已注册', '尚无有效 AppID；替换 touristappid 后继续检查账号类型');
    check('account-registration', config.accountMode === 'registered',
      '本机标记为已注册账号；后台主体与发布资格仍待核对',
      config.accountMode === 'test' ? '当前为微信测试号，仅用于开发预览；正式发布仍需注册账号' : '账号注册状态未确认；核对后台后填写 accountMode');
    check('backend-appid', realId && env.WECHAT_MINIPROGRAM_APP_ID === appId,
      '本机服务端 AppID 与客户端一致', '本机服务端尚未配置一致的 WECHAT_MINIPROGRAM_APP_ID');
    check('backend-secret', typeof secret === 'string' && /^[0-9a-f]{32}$/iu.test(secret),
      '本机已填写 AppSecret 格式，未输出值', '本机 AppSecret 未配置或格式不完整；仅写入根 .env 或部署密钥');
    check('mock-mode', config.mockMode === false, '已关闭 mock', '当前仍为 mock；接通正式后端后再关闭');
    check('api-origin', onlineOrigin(config.apiBaseUrl), '已填写 HTTPS API 源地址，线上可用性待验收', 'API 地址须为不带路径、查询或结尾斜杠的 HTTPS 源地址');
    check('url-check', project.setting?.urlCheck === true && (privateProject.setting?.urlCheck ?? true) === true,
      '项目与本机配置均启用域名校验', '开启项目及 private 配置的 urlCheck，勿跳过合法域名校验');
    check('account-capabilities', ['personal', 'organization'].includes(config.accountType)
      && typeof config.webViewEnabled === 'boolean' && (config.accountType !== 'personal' || config.webViewEnabled === false),
    '主体与网页能力开关一致', '个人主体须关闭 webViewEnabled；主体填写 personal 或 organization');
    if (config.accountType === 'organization' && config.webViewEnabled === true) {
      check('web-origin', onlineOrigin(config.webBaseUrl), '已填写 HTTPS 网页源地址，业务域名待后台核对', '启用内嵌网页需填写 HTTPS 网页源地址');
    }
    const leaked = typeof secret === 'string' && secret.length >= 16 && await clientContains(clientRoot, secret);
    check('secret-location', !leaked, '客户端源文件未发现当前配置的 AppSecret', '客户端源文件含当前 AppSecret；移除并在微信后台重置，不提交 Git');
  } catch {
    // Parse/read errors can contain input values. Emit a fixed diagnostic only.
    check('read-config', false, '', '配置文件读取或解析失败；检查 miniapp 配置与根 .env，诊断不回显文件内容');
  }
  return { configurationReady: checks.length > 0 && checks.every((item) => item.status === 'pass'), checks, externalVerification };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await checkMiniappReady(fileURLToPath(new URL('../', import.meta.url)));
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('PETSCAPE 本机配置检查（只读，不代表可上线或微信后台已验证）');
    for (const item of report.checks) console.log(`[${item.status}] ${item.message}`);
    console.log('后续：' + report.externalVerification.join(' → '));
  }
  if (process.argv.includes('--check') && !report.configurationReady) process.exitCode = 1;
}
