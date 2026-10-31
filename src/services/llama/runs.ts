/**
 * llama 任务的并发管理。
 *
 * 设计要点：
 * - 同时运行的数量有上限（默认 3），超出的进入 `queued`，有槽位时自动启动；
 * - 每个任务独立的输出缓冲、独立的取消入口，互不干扰；
 * - 任务生命周期与面板无关：关掉面板再打开，跑着的任务和已产出的输出还在；
 * - 输出超过上限只保留尾部，避免长跑任务把内存吃光。
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { DisposableLike } from '../../core/types';
import { toShellCommand } from './command';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface RunSpec {
  label: string;
  execPath: string;
  args: readonly string[];
  cwd?: string;
}

export interface RunSnapshot {
  id: string;
  label: string;
  status: RunStatus;
  command: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  exitCode?: number;
  output: string;
  truncated: boolean;
}

interface RunState {
  spec: RunSpec;
  snapshot: RunSnapshot;
  child?: ChildProcess;
  cancelled: boolean;
  output: string;
}

export type SpawnFn = (
  execPath: string,
  args: readonly string[],
  options: { cwd?: string; windowsHide: boolean },
) => ChildProcess;

export interface RunManagerOptions {
  maxConcurrent?: number;
  outputLimit?: number;
  spawn?: SpawnFn;
  terminate?: (child: ChildProcess) => void;
  now?: () => number;
  idFactory?: () => string;
}

function defaultTerminate(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    // Windows 上 kill() 只杀直接子进程，llama.cpp 可能还有子进程，用 taskkill 连根拔。
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  child.kill('SIGTERM');
}

export class RunManager {
  private readonly runs = new Map<string, RunState>();
  private readonly order: string[] = [];
  private readonly runListeners = new Set<(snapshots: RunSnapshot[]) => void>();
  private readonly chunkListeners = new Set<(id: string, chunk: string) => void>();
  private readonly maxConcurrent: number;
  private readonly outputLimit: number;
  private readonly spawnFn: SpawnFn;
  private readonly terminate: (child: ChildProcess) => void;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private sequence = 0;

  constructor(options: RunManagerOptions = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 3);
    this.outputLimit = Math.max(4096, options.outputLimit ?? 200_000);
    this.spawnFn = options.spawn ?? ((execPath, args, opts) => spawn(execPath, [...args], opts));
    this.terminate = options.terminate ?? defaultTerminate;
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? (() => `run-${(this.sequence += 1)}`);
  }

  get limit(): number {
    return this.maxConcurrent;
  }

  start(spec: RunSpec): RunSnapshot {
    const id = this.idFactory();
    const state: RunState = {
      spec,
      cancelled: false,
      output: '',
      snapshot: {
        id,
        label: spec.label,
        status: 'queued',
        command: toShellCommand(spec.execPath, spec.args),
        createdAt: this.now(),
        output: '',
        truncated: false,
      },
    };

    this.runs.set(id, state);
    this.order.push(id);
    this.pump();
    this.emitRuns();
    return { ...state.snapshot };
  }

  cancel(id: string): void {
    const state = this.runs.get(id);
    if (!state) {
      return;
    }
    state.cancelled = true;

    if (state.snapshot.status === 'queued') {
      state.snapshot.status = 'cancelled';
      state.snapshot.endedAt = this.now();
      this.emitRuns();
      this.pump();
      return;
    }

    if (state.snapshot.status === 'running' && state.child) {
      this.append(state, '\n[已请求终止]\n');
      this.terminate(state.child);
    }
  }

  remove(id: string): void {
    const state = this.runs.get(id);
    if (!state || state.snapshot.status === 'running' || state.snapshot.status === 'queued') {
      return;
    }
    this.runs.delete(id);
    const index = this.order.indexOf(id);
    if (index >= 0) {
      this.order.splice(index, 1);
    }
    this.emitRuns();
  }

  clearFinished(): void {
    for (const id of [...this.order]) {
      this.remove(id);
    }
  }

  snapshots(): RunSnapshot[] {
    return this.order
      .map((id) => this.runs.get(id))
      .filter((state): state is RunState => state !== undefined)
      .map((state) => ({ ...state.snapshot }));
  }

  onRuns(listener: (snapshots: RunSnapshot[]) => void): DisposableLike {
    this.runListeners.add(listener);
    listener(this.snapshots());
    return { dispose: () => void this.runListeners.delete(listener) };
  }

  onOutput(listener: (id: string, chunk: string) => void): DisposableLike {
    this.chunkListeners.add(listener);
    return { dispose: () => void this.chunkListeners.delete(listener) };
  }

  dispose(): void {
    for (const state of this.runs.values()) {
      if (state.snapshot.status === 'running' && state.child) {
        this.terminate(state.child);
      }
    }
    this.runs.clear();
    this.order.length = 0;
    this.runListeners.clear();
    this.chunkListeners.clear();
  }

  private runningCount(): number {
    let count = 0;
    for (const state of this.runs.values()) {
      if (state.snapshot.status === 'running') {
        count += 1;
      }
    }
    return count;
  }

  private pump(): void {
    let slots = this.maxConcurrent - this.runningCount();
    if (slots <= 0) {
      return;
    }
    for (const id of this.order) {
      if (slots <= 0) {
        break;
      }
      const state = this.runs.get(id);
      if (!state || state.snapshot.status !== 'queued') {
        continue;
      }
      this.launch(state);
      slots -= 1;
    }
  }

  private launch(state: RunState): void {
    state.snapshot.status = 'running';
    state.snapshot.startedAt = this.now();

    let child: ChildProcess;
    try {
      child = this.spawnFn(state.spec.execPath, state.spec.args, {
        cwd: state.spec.cwd,
        windowsHide: true,
      });
    } catch (error) {
      this.finish(state, 'failed', undefined, `\n[启动失败] ${describe(error)}\n`);
      return;
    }

    state.child = child;
    child.stdout?.on('data', (chunk: Buffer) => this.append(state, chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => this.append(state, chunk.toString()));
    child.on('error', (error: Error) => this.finish(state, 'failed', undefined, `\n[进程错误] ${error.message}\n`));
    child.on('close', (code: number | null) => {
      const status: RunStatus = state.cancelled ? 'cancelled' : code === 0 ? 'succeeded' : 'failed';
      this.finish(state, status, code ?? undefined);
    });

    this.emitRuns();
  }

  private finish(state: RunState, status: RunStatus, exitCode?: number, note?: string): void {
    if (state.snapshot.status !== 'running' && state.snapshot.status !== 'queued') {
      return;
    }
    if (note) {
      this.append(state, note);
    }
    state.snapshot.status = status;
    state.snapshot.exitCode = exitCode;
    state.snapshot.endedAt = this.now();
    state.child = undefined;
    this.emitRuns();
    this.pump();
  }

  private append(state: RunState, chunk: string): void {
    if (!chunk) {
      return;
    }
    state.output += chunk;
    if (state.output.length > this.outputLimit) {
      state.output = state.output.slice(-this.outputLimit);
      state.snapshot.truncated = true;
    }
    state.snapshot.output = state.output;

    for (const listener of this.chunkListeners) {
      listener(state.snapshot.id, chunk);
    }
  }

  private emitRuns(): void {
    const snapshots = this.snapshots();
    for (const listener of this.runListeners) {
      listener(snapshots);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
