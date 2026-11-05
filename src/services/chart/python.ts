/** 找 Python、写脚本、跑 matplotlib 导出图片。 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { RENDER_SCRIPT } from './renderScript';
import type { ChartSpec } from './spec';

export interface PythonRunner {
  command: string;
  /** 前缀参数，比如 `py -3` 里的 `-3` */
  args: string[];
}

/**
 * 依次尝试：设置里指定的 → `python` → `py -3` → `python3`。
 * 只要有一个能 `import matplotlib` 就用它。
 */
export function pythonCandidates(configured: string): PythonRunner[] {
  const candidates: PythonRunner[] = [];
  const trimmed = configured.trim();
  if (trimmed !== '') {
    candidates.push({ command: trimmed, args: [] });
  }
  candidates.push({ command: 'python', args: [] });
  candidates.push({ command: 'py', args: ['-3'] });
  candidates.push({ command: 'python3', args: [] });
  return candidates;
}

function pythonEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
}

export function probePython(candidate: PythonRunner, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      candidate.command,
      [...candidate.args, '-c', 'import matplotlib'],
      { timeout: timeoutMs, windowsHide: true, env: pythonEnv() },
      (error) => resolve(!error),
    );
  });
}

export async function findPython(configured: string): Promise<PythonRunner | undefined> {
  for (const candidate of pythonCandidates(configured)) {
    if (await probePython(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

export function runPython(
  candidate: PythonRunner,
  args: readonly string[],
  timeoutMs = 120_000,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      candidate.command,
      [...candidate.args, ...args],
      { timeout: timeoutMs, windowsHide: true, env: pythonEnv(), maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || '').trim() || error.message;
          reject(new Error(detail.split('\n').slice(-6).join('\n')));
          return;
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });
}

export interface RenderRequest {
  python: PythonRunner;
  storageDir: string;
  spec: ChartSpec;
  outPath: string;
}

/** 写脚本 + 数据，然后跑一次导出；返回写出来的文件路径，便于排查。 */
export async function renderFigure(request: RenderRequest): Promise<{ scriptPath: string; specPath: string }> {
  await fs.mkdir(request.storageDir, { recursive: true });

  const scriptPath = path.join(request.storageDir, 'render_chart.py');
  const specPath = path.join(request.storageDir, 'chart-spec.json');

  await fs.writeFile(scriptPath, RENDER_SCRIPT, 'utf8');
  await fs.writeFile(specPath, JSON.stringify(request.spec, null, 2), 'utf8');
  await runPython(request.python, [scriptPath, specPath, request.outPath]);

  return { scriptPath, specPath };
}
