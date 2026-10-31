/**
 * 更新检查里与网络无关的部分：版本比较、Release 解析、资产挑选。
 * 纯函数，直接单测。
 */

export interface ReleaseAsset {
  name: string;
  url: string;
  size?: number;
}

export interface ReleaseInfo {
  tag: string;
  version: string;
  url: string;
  notes?: string;
  assets: ReleaseAsset[];
}

export function normalizeVersion(raw: string): string {
  const trimmed = raw.trim().replace(/^v/i, '');
  const match = /(\d+(?:\.\d+){0,2})/.exec(trimmed);
  return match ? match[1] : trimmed;
}

export function compareVersions(left: string, right: string): number {
  const a = normalizeVersion(left)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  const b = normalizeVersion(right)
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x !== y) {
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

export function parseRelease(payload: unknown): ReleaseInfo | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const tag = typeof record.tag_name === 'string' ? record.tag_name : undefined;
  if (!tag) {
    return undefined;
  }

  const assets: ReleaseAsset[] = [];
  for (const item of Array.isArray(record.assets) ? record.assets : []) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const asset = item as Record<string, unknown>;
    if (typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') {
      continue;
    }
    assets.push({
      name: asset.name,
      url: asset.browser_download_url,
      size: typeof asset.size === 'number' ? asset.size : undefined,
    });
  }

  return {
    tag,
    version: normalizeVersion(tag),
    url: typeof record.html_url === 'string' ? record.html_url : '',
    notes: typeof record.body === 'string' ? record.body : undefined,
    assets,
  };
}

/**
 * 挑出要安装的 vsix。
 * 优先匹配当前平台（`win32-x64` 之类），其次选不带平台标记的通用包。
 */
export function pickVsixAsset(
  release: ReleaseInfo,
  platformHint = `${process.platform}-${process.arch}`,
): ReleaseAsset | undefined {
  const candidates = release.assets.filter((asset) => /\.vsix$/i.test(asset.name));
  if (candidates.length === 0) {
    return undefined;
  }

  const exact = candidates.find((asset) =>
    asset.name.toLowerCase().includes(platformHint.toLowerCase()),
  );
  if (exact) {
    return exact;
  }

  const universal = candidates.find(
    (asset) => !/(win32|linux|darwin|alpine|arm64|x64|ia32)/i.test(asset.name),
  );
  return universal ?? candidates[0];
}
