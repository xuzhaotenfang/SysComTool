import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import type { Logger } from '../core/types';
import { parseTabularData, previewDataset, type Dataset } from '../services/chart/parse';
import {
  computeFormulas,
  resultToDataset,
  type Binding,
  type ComputeFormula,
  type ComputeResult,
} from '../services/formula/compute';
import { collectVariables, parseFormulas } from '../services/formula/latex';
import { renderFormulaHtml, sampleDataset, type FormulaPanelState } from './formulaHtml';
import { createNonce } from './webview';

export interface FormulaPanelDeps {
  context: vscode.ExtensionContext;
  logger: Logger;
  /** 「用结果出图」：把结果列交给数据出图面板 */
  openChart: (dataset: Dataset) => void;
}

const PREVIEW_ROWS = 10;

/** 建模计算面板：CSV + LaTeX 公式 → 新的计算列。 */
export class FormulaPanel {
  private panel?: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private dataset?: Dataset;
  private lastResult?: ComputeResult;

  constructor(private readonly deps: FormulaPanelDeps) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'syscomtool.formula',
      'SysComTool · 建模计算',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel = panel;
    panel.webview.html = renderFormulaHtml(panel.webview, this.snapshotState(), createNonce());

    panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        void this.handle(message);
      },
      undefined,
      this.disposables,
    );
    panel.onDidDispose(() => this.close(), undefined, this.disposables);
  }

  dispose(): void {
    this.panel?.dispose();
    this.close();
  }

  private close(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.panel = undefined;
  }

  private post(message: unknown): void {
    void this.panel?.webview.postMessage(message);
  }

  private snapshotState(): FormulaPanelState | undefined {
    if (!this.dataset) {
      return undefined;
    }
    const preview = previewDataset(this.dataset, PREVIEW_ROWS);
    return {
      columns: this.dataset.columns,
      preview: preview.rows,
      total: preview.total,
      format: this.dataset.format,
      warnings: this.dataset.warnings,
    };
  }

  private async handle(raw: unknown): Promise<void> {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const message = raw as Record<string, unknown>;
    const type = typeof message.type === 'string' ? message.type : '';

    switch (type) {
      case 'ready': {
        const state = this.snapshotState();
        if (state) {
          this.post({ type: 'dataset', state });
        }
        return;
      }
      case 'parseText':
        this.load(typeof message.text === 'string' ? message.text : '');
        return;
      case 'openFile':
        await this.openFile();
        return;
      case 'sample':
        this.load(sampleDataset());
        return;
      case 'parseFormulas':
        this.parseFormulaText(typeof message.text === 'string' ? message.text : '');
        return;
      case 'compute':
        this.compute(message.formulas, message.bindings);
        return;
      case 'exportCsv':
        await this.exportCsv();
        return;
      case 'toChart':
        this.toChart();
        return;
      default:
        this.deps.logger.debug(`未处理的公式消息：${type}`);
    }
  }

  private load(text: string): void {
    const result = parseTabularData(text);
    if (!result.ok) {
      this.post({ type: 'error', message: result.error });
      return;
    }

    this.dataset = result.dataset;
    this.lastResult = undefined;
    this.deps.logger.info(
      `建模计算已载入 ${result.dataset.rows.length} 行 × ${result.dataset.columns.length} 列`,
    );

    const state = this.snapshotState();
    if (state) {
      this.post({ type: 'dataset', state });
    }
  }

  private async openFile(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: '选择数据文件',
      filters: {
        表格: ['csv', 'tsv', 'md', 'markdown', 'txt'],
        所有文件: ['*'],
      },
    });
    if (!picked?.length) {
      return;
    }

    try {
      this.load(await fs.readFile(picked[0].fsPath, 'utf8'));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn(`读取数据文件失败：${reason}`);
      this.post({ type: 'error', message: `读取失败：${reason}` });
    }
  }

  private parseFormulaText(text: string): void {
    const parsed = parseFormulas(text);
    this.post({
      type: 'formulas',
      formulas: parsed.formulas,
      variables: parsed.variables,
      errors: parsed.errors,
    });
  }

  private compute(rawFormulas: unknown, rawBindings: unknown): void {
    if (!this.dataset) {
      this.post({ type: 'error', message: '还没有数据：先粘贴内容或打开一个 CSV' });
      return;
    }

    const formulas = sanitizeFormulas(rawFormulas);
    if (formulas.length === 0) {
      return;
    }
    const bindings = sanitizeBindings(rawBindings, this.dataset.columns.length);

    const missing = collectMissingBindings(formulas, bindings);
    if (missing.length > 0) {
      this.post({ type: 'error', message: `这些因子还没绑定：${missing.join('、')}` });
      return;
    }

    const result = computeFormulas(this.dataset, formulas, bindings);
    this.lastResult = result;

    this.post({
      type: 'result',
      columns: result.columns,
      rows: result.rows,
      okRows: result.okRows,
      totalRows: result.totalRows,
      errorRows: result.errorRows,
      errors: result.errors,
    });

    this.deps.logger.info(
      `建模计算：${result.okRows}/${result.totalRows} 行成功，` +
        `${result.computed.join('、') || '无新列'}`,
    );
  }

  private async exportCsv(): Promise<void> {
    if (!this.lastResult) {
      void vscode.window.showWarningMessage('还没有计算结果：先给数据和公式');
      return;
    }

    const target = await vscode.window.showSaveDialog({
      saveLabel: '导出结果 CSV',
      filters: { CSV: ['csv'] },
      defaultUri: this.defaultUri('model-result.csv'),
    });
    if (!target) {
      return;
    }

    const header = this.lastResult.columns.map((column) => escapeCsv(column.name)).join(',');
    const lines = [header, ...this.lastResult.rows.map((row) => row.map(escapeCsv).join(','))];

    try {
      await fs.writeFile(target.fsPath, lines.join('\n'), 'utf8');
      void vscode.window.showInformationMessage(`结果已导出：${target.fsPath}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`导出失败：${reason}`);
    }
  }

  private toChart(): void {
    if (!this.lastResult) {
      void vscode.window.showWarningMessage('还没有计算结果：先给数据和公式');
      return;
    }
    this.deps.openChart(resultToDataset(this.lastResult));
  }

  private defaultUri(fileName: string): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? vscode.Uri.joinPath(folder.uri, fileName) : undefined;
  }
}

function sanitizeFormulas(raw: unknown): ComputeFormula[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const formulas: ComputeFormula[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.expression !== 'string') {
      continue;
    }
    if (record.name.trim() === '' || record.expression.trim() === '') {
      continue;
    }
    formulas.push({ name: record.name, expression: record.expression });
  }
  return formulas;
}

function sanitizeBindings(raw: unknown, columnCount: number): Record<string, Binding> {
  const bindings: Record<string, Binding> = {};
  if (typeof raw !== 'object' || raw === null) {
    return bindings;
  }

  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    const record = value as Record<string, unknown>;
    if (record.kind === 'column') {
      const index = Number(record.index);
      if (Number.isInteger(index) && index >= 0 && index < columnCount) {
        bindings[name] = { kind: 'column', index };
      }
      continue;
    }
    if (record.kind === 'constant') {
      const constant = Number(record.value);
      bindings[name] = { kind: 'constant', value: Number.isFinite(constant) ? constant : 0 };
    }
  }
  return bindings;
}

function collectMissingBindings(
  formulas: readonly ComputeFormula[],
  bindings: Readonly<Record<string, Binding>>,
): string[] {
  const known = new Set(Object.keys(bindings));
  const missing = new Set<string>();

  for (const formula of formulas) {
    for (const name of collectVariables(formula.expression)) {
      if (!known.has(name)) {
        missing.add(name);
      }
    }
    // 本条的结果可以给后面的公式用，不算缺绑定
    known.add(formula.name);
  }
  return [...missing];
}



function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
