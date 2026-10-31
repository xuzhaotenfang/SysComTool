/**
 * 自动更新：查 Release → 下载 vsix → 调 `code --install-extension`。
 * 只负责「装」，重启窗口由调用方提示用户。
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '../../core/types';
import {
  compareVersions,
  parseRelease,
  pickVsixAsset,
  type ReleaseAsset,
  type ReleaseInfo,
} from './check';

export interface UpdateCandidate {
  release: ReleaseInfo;
  asset: ReleaseAsset;
}

export interface UpdaterOptions {
  logger: Logger;
  currentVersion: string;
  /** 下载下来的 vsix 放这里（扩展的 globalStorage） */
  storageDir: string;
  feedUrl: () => string;
  fetchImpl?: typeof fetch;
}

export class Updater {
  constructor(private readonly options: UpdaterOptions) {}

  /** 拉最新的 release；网络或格式问题会抛出，由调用方决定是否提示用户。 */
  async latest(): Promise<ReleaseInfo> {
    const release = parseRelease(await this.fetchJson(this.options.feedUrl()));
    if (!release) {
      throw new Error('更新源返回的内容不是有效的 release 信息');
    }
    return release;
  }

  /** 有更新时返回候选，否则 undefined。 */
  async check(): Promise<UpdateCandidate | undefined> {
    const release = await this.latest();
    if (compareVersions(release.version, this.options.currentVersion) <= 0) {
      this.options.logger.debug(`已是最新版本 ${this.options.currentVersion}`);
      return undefined;
    }
    const asset = pickVsixAsset(release);
    if (!asset) {
      this.options.logger.warn(`release ${release.tag} 里没有 .vsix 资产，跳过更新`);
      return undefined;
    }
    return { release, asset };
  }

  /** 下载并安装，返回本地 vsix 路径。 */
  async install(candidate: UpdateCandidate): Promise<string> {
    const vsixPath = await this.download(candidate.asset, candidate.release.version);
    this.options.logger.info(`开始安装 ${vsixPath}`);
    await runCodeCli(['--install-extension', vsixPath, '--force']);
    this.options.logger.info(`已安装 ${candidate.release.version}`);
    return vsixPath;
  }

  private async download(asset: ReleaseAsset, version: string): Promise<string> {
    await fs.mkdir(this.options.storageDir, { recursive: true });
    await this.cleanup();

    const fileName = `syscomtool-${version}.vsix`;
    const target = path.join(this.options.storageDir, fileName);
    const response = await this.request(asset.url);
    await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
    return target;
  }

  private async cleanup(): Promise<void> {
    try {
      for (const name of await fs.readdir(this.options.storageDir)) {
        if (name.toLowerCase().endsWith('.vsix')) {
          await fs.rm(path.join(this.options.storageDir, name), { force: true });
        }
      }
    } catch {
      // 目录不存在或删不掉，都不影响这次下载
    }
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await this.request(url);
    return response.json();
  }

  private async request(url: string): Promise<Response> {
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error('当前 Node 运行时不支持 fetch，无法检查更新');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'syscomtool-vscode',
        },
      });
      if (!response.ok) {
        throw new Error(`更新源返回 HTTP ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 调 VS Code 的 CLI 安装 vsix。 */
export function runCodeCli(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? // code 在 Windows 上是 code.cmd，只能经 cmd.exe 调用
          spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'code', ...args], {
            windowsHide: true,
          })
        : spawn('code', [...args], { windowsHide: true });

    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      reject(new Error(`调用 code 命令失败：${error.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`code --install-extension 失败（退出码 ${code}）：${output.trim()}`));
      }
    });
  });
}
