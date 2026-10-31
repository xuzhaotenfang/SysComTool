/**
 * 找 llama.cpp、认版本。
 *
 * 纯逻辑（名字判断、版本解析）与 IO（目录扫描、调用 --version）分开，
 * 前者可以被单测覆盖。
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** llama.cpp 构建产物里常见的可执行文件名（不含扩展名）。 */
const BUILD_NAMES = new Set(['llama-cli', 'llama-server', 'main', 'llama']);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  'models',
  'dist',
  'obj',
]);

export function isExecutableName(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  if (ext !== '' && ext !== '.exe') {
    return false;
  }
  return BUILD_NAMES.has(path.basename(fileName, ext).toLowerCase());
}

export interface VersionInfo {
  version?: string;
  build?: string;
  raw: string;
}

/**
 * 解析 `llama-cli --version` 的输出。不同版本格式略有差异，这里宽松匹配：
 *
 * ```
 * version: 4615 (6d1c3e1)
 * built with MSVC 19.40 for x64
 * ```
 */
export function parseVersionOutput(raw: string): VersionInfo {
  const versionMatch = /(?:^|\n)\s*version:\s*([^\s(]+)\s*(?:\(([^)]+)\))?/i.exec(raw);
  const compilerMatch = /(?:^|\n)\s*built with\s+(.+)/i.exec(raw);
  const buildNumberMatch = /(?:^|\n)\s*build(?:_number)?:\s*(.+)/i.exec(raw);

  const build = (
    buildNumberMatch?.[1] ??
    compilerMatch?.[1] ??
    versionMatch?.[2]
  )?.trim();

  return {
    version: versionMatch?.[1]?.trim(),
    build: build || undefined,
    raw,
  };
}

/** 跑一次 `--version`；失败也返回 raw（llama.cpp 有时把版本打到 stderr 且退出码非 0）。 */
export function probeVersion(execPath: string, timeoutMs = 8000): Promise<VersionInfo> {
  return new Promise((resolve) => {
    execFile(
      execPath,
      ['--version'],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const raw = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
        if (!raw) {
          resolve({ raw: error ? error.message : '' });
          return;
        }
        resolve(parseVersionOutput(raw));
      },
    );
  });
}

export interface ScanOptions {
  maxDepth?: number;
  maxEntries?: number;
}

function candidateScore(candidate: string): number {
  if (/build[\\/]bin[\\/]/i.test(candidate)) {
    return 0;
  }
  if (/[\\/]bin[\\/]/i.test(candidate)) {
    return 1;
  }
  return 2;
}

/**
 * 广度优先扫描若干根目录，找 llama.cpp 的可执行文件。
 * 有上限（深度 / 条目数），扫描整个大目录也不会卡死。
 */
export async function scanForExecutables(
  roots: readonly string[],
  options: ScanOptions = {},
): Promise<string[]> {
  const maxDepth = options.maxDepth ?? 4;
  const maxEntries = options.maxEntries ?? 6000;
  const queue: Array<{ dir: string; depth: number }> = roots.map((root) => ({ dir: root, depth: 0 }));
  const found: string[] = [];
  const seen = new Set<string>();
  let visited = 0;

  while (queue.length > 0 && visited < maxEntries) {
    const next = queue.shift();
    if (!next) {
      break;
    }

    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    visited += entries.length;

    for (const entry of entries) {
      const full = path.join(next.dir, entry.name);
      if (entry.isDirectory()) {
        if (next.depth >= maxDepth || SKIP_DIRS.has(entry.name.toLowerCase())) {
          continue;
        }
        queue.push({ dir: full, depth: next.depth + 1 });
      } else if (entry.isFile() && isExecutableName(entry.name)) {
        const key = full.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          found.push(full);
        }
      }
    }
  }

  return found.sort((a, b) => candidateScore(a) - candidateScore(b) || a.localeCompare(b));
}

/** 在一个目录里找（用于「选文件夹」按钮），深度小一点，返回里优先 build/bin。 */
export function scanFolder(folder: string): Promise<string[]> {
  return scanForExecutables([folder], { maxDepth: 5, maxEntries: 8000 });
}

export function profileName(execPath: string, version?: string): string {
  const base = path.basename(execPath);
  return version ? `${base} (${version})` : base;
}

export function isLikelyLlamaCppDir(dir: string): boolean {
  const name = path.basename(dir).toLowerCase();
  return name === 'llama.cpp' || name === 'llama-cpp' || name === 'llamacpp';
}
