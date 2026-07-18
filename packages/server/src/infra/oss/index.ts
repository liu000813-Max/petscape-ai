// infra/oss/ —— 阿里云 OSS 适配器（WP-3.2）。
// spec: docs/plans/phase-b-execution-plan.md WP-3.2；ADR-0005（对象存储）。
//
// 本包边界（ADR-0005 + 主控指示）：只做签名 URL 小文件路径（PUT 上传、GET 下载、
// HEAD 校验）；STS 临时凭证与 Browser.js multipart/resumable upload 不在本包范围
// （Phase C/D 大文件能力）。
//
// 凭证与终端节点全部经 infra/config 传入（不读 process.env——lint 边界规则）。
import OSS from 'ali-oss';

export interface OssClientOptions {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  /** 公网 endpoint（签名 URL 面向客户端，必须是公网可达地址）。 */
  endpoint: string;
  /** V4 签名必需（signatureUrlV4 用其推导 signing region），非 optional。 */
  region: string;
}

export interface OssObjectHead {
  exists: boolean;
  size?: number;
  etag?: string;
}

/**
 * 薄封装：签发 V4 签名 URL（PUT/GET）+ HEAD 校验对象是否存在。
 * 不缓存/单例——调用方（application 层用例）按需构造，构造成本低（ali-oss Client
 * 构造函数不发起网络请求）。
 */
export class OssStorage {
  private readonly client: OSS;
  readonly bucket: string;

  constructor(options: OssClientOptions) {
    this.bucket = options.bucket;
    this.client = new OSS({
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      bucket: options.bucket,
      endpoint: options.endpoint,
      region: options.region,
      secure: true,
      // 普通 API 请求（head/list/delete 等，非签名 URL）的请求头签名走 V4
      // （createRequest.js 据此选择 authorizationV4() 还是 authorization()）。
      // 签名 URL 走独立的 signatureUrlV4() 方法（见 signPutUrl/signGetUrl），
      // 这个选项对 signatureUrl()/signatureUrlV4() 的选择没有影响。
      authorizationV4: true,
    });
  }

  /**
   * 签发短 TTL 的 PUT 签名 URL，供客户端直传单个小文件对象。使用 V4 签名
   * （`signatureUrlV4`，ADR-0005 验证条件 1）——ali-oss 的 `signatureUrl`/
   * `authorizationV4` client 选项走的是 V1 签名算法，不受 `authorizationV4`
   * 影响，V4 签名只能通过 `signatureUrlV4` 这个独立（async）方法获得。
   * @param key OSS 对象 key（调用方按 ADR-0005 规则构造，本模块不做规则判断）。
   * @param expiresSeconds 签名 URL 有效期（秒）。
   */
  async signPutUrl(key: string, expiresSeconds: number): Promise<string> {
    return this.client.signatureUrlV4('PUT', expiresSeconds, undefined, key);
  }

  /** 签发短 TTL 的 GET 签名 URL（V4 签名），供客户端下载单个对象。 */
  async signGetUrl(key: string, expiresSeconds: number): Promise<string> {
    return this.client.signatureUrlV4('GET', expiresSeconds, undefined, key);
  }

  /**
   * HEAD 校验对象是否存在及其大小（confirmAssetUpload 用例据此核对客户端声明的大小）。
   * 对象不存在时返回 `{ exists: false }`，不抛错（调用方按业务语义处理，不是异常路径）。
   */
  async head(key: string): Promise<OssObjectHead> {
    try {
      const result = await this.client.head(key);
      const headers = result.res.headers as Record<string, string | undefined>;
      const size = Number(headers['content-length']);
      const etag = typeof headers.etag === 'string' ? headers.etag : undefined;
      return { exists: true, size: Number.isFinite(size) ? size : undefined, etag };
    } catch (error) {
      if (isNotFoundError(error)) {
        return { exists: false };
      }
      throw error;
    }
  }

  /** 列举给定前缀下的对象 key（WP-3.2 验收 4：数据库/OSS 前缀对账用）。 */
  async listKeysByPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let marker: string | undefined;
    do {
      // 注意：query 对象不能显式带值为 undefined 的 `marker` 键（即便值是
      // undefined）——V4 签名的 canonical query string 计算与实际发出的请求
      // 之间会因此出现字段存在与否的不一致，导致 SignatureDoesNotMatch。
      // 用条件展开，marker 不存在时干脆不传这个 query 键。
      const query: OSS.ListObjectsQuery = { prefix, 'max-keys': 1000, ...(marker ? { marker } : {}) };
      const result = await this.client.list(query, {});
      for (const obj of result.objects ?? []) {
        keys.push(obj.name);
      }
      marker = result.nextMarker ?? undefined;
    } while (marker);
    return keys;
  }

  /** 删除单个对象（测试清理专用；正式业务流程不经此方法删除资产）。 */
  async delete(key: string): Promise<void> {
    await this.client.delete(key);
  }
}

function isNotFoundError(error: unknown): boolean {
  const code = (error as { code?: string; status?: number } | undefined)?.code;
  const status = (error as { code?: string; status?: number } | undefined)?.status;
  return code === 'NoSuchKey' || status === 404;
}
