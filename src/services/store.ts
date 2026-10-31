import type * as vscode from 'vscode';

/** 一个被保存的 llama.cpp 可执行文件（用户口中的「llama.cpp 选项」）。 */
export interface LlamaProfile {
  id: string;
  name: string;
  /** llama-cli / main 的完整路径 */
  execPath: string;
  /** 它所在的目录，界面上展示用 */
  dirPath: string;
  version?: string;
  build?: string;
  savedAt: number;
}

export interface PersistedState {
  schema: 1;
  llamaProfiles: LlamaProfile[];
  activeProfileId?: string;
  /** 最近用过的模型，最新的在前 */
  recentModels: string[];
  lastUpdateCheckAt?: number;
  /** 上次提醒过的版本，避免同一版本反复弹 */
  lastNotifiedVersion?: string;
}

const STATE_KEY = 'syscomtool.state';
const RECENT_MODELS_LIMIT = 8;

function emptyState(): PersistedState {
  return { schema: 1, llamaProfiles: [], recentModels: [] };
}

function dedupeModels(models: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const model of models) {
    const key = model.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(model);
  }
  return result.slice(0, RECENT_MODELS_LIMIT);
}

/**
 * 持久化层（`context.globalState`）。
 *
 * 写入走一条 promise 链串行执行：多个功能同时改状态时，
 * 后面的写入一定读到前面的结果，不会互相覆盖。
 */
export class Store {
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly memento: vscode.Memento) {}

  state(): PersistedState {
    const raw = this.memento.get<PersistedState>(STATE_KEY);
    if (!raw || raw.schema !== 1) {
      return emptyState();
    }
    return {
      ...emptyState(),
      ...raw,
      llamaProfiles: [...(raw.llamaProfiles ?? [])],
      recentModels: [...(raw.recentModels ?? [])],
    };
  }

  /** 按 execPath 去重：同一个可执行文件只留一条，更新版本信息。 */
  saveLlamaProfile(
    input: Omit<LlamaProfile, 'id' | 'savedAt'>,
  ): Promise<LlamaProfile> {
    return this.enqueue(async () => {
      const state = this.state();
      const existing = state.llamaProfiles.find(
        (item) => item.execPath.toLowerCase() === input.execPath.toLowerCase(),
      );
      const profile: LlamaProfile = {
        ...input,
        id: existing?.id ?? newId(),
        savedAt: Date.now(),
      };
      const profiles = existing
        ? state.llamaProfiles.map((item) => (item.id === existing.id ? profile : item))
        : [...state.llamaProfiles, profile];
      await this.write({ ...state, llamaProfiles: profiles, activeProfileId: profile.id });
      return profile;
    });
  }

  removeLlamaProfile(id: string): Promise<void> {
    return this.enqueue(async () => {
      const state = this.state();
      const profiles = state.llamaProfiles.filter((item) => item.id !== id);
      const activeProfileId =
        state.activeProfileId === id ? profiles[0]?.id : state.activeProfileId;
      await this.write({ ...state, llamaProfiles: profiles, activeProfileId });
    });
  }

  setActiveProfile(id: string | undefined): Promise<void> {
    return this.enqueue(async () => {
      await this.write({ ...this.state(), activeProfileId: id });
    });
  }

  addRecentModel(modelPath: string): Promise<void> {
    return this.enqueue(async () => {
      const state = this.state();
      const recentModels = dedupeModels([modelPath, ...state.recentModels]);
      await this.write({ ...state, recentModels });
    });
  }

  markUpdateCheck(version: string): Promise<void> {
    return this.enqueue(async () => {
      const state = this.state();
      await this.write({ ...state, lastUpdateCheckAt: Date.now(), lastNotifiedVersion: version });
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private write(next: PersistedState): Promise<void> {
    return Promise.resolve(this.memento.update(STATE_KEY, next));
  }
}

function newId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `llama-${Date.now().toString(36)}-${random}`;
}
