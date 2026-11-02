import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import type { Logger } from '../core/types';
import { buildChartModel, type ChartOptions, type ChartType } from '../services/chart/model';
import { inferDefaults } from '../services/chart/infer';
import { parseTabularData, previewDataset, toNumber, type Dataset } from '../services/chart/parse';
import { renderChartHtml, sampleDataset, type ChartPanelState } from './chartHtml';
import { createNonce } from './webview';

export interface ChartPanelDeps {
  context: vscode.ExtensionContext;
  logger: Logger;
}

const CHART_TYPES: readonly ChartType[] = ['line', 'smooth', 'scatter', 'bar', 'area'];
const PREVIEW_ROWS = 10;

/** 数据出图面板：解析 → 选列 → 画图 → 导出。 */
export class ChartPanel {
  private panel?: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private dataset?: Dataset;

  constructor(private readonly deps: ChartPanelDeps) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'syscomtool.chart',
      'SysComTool · 数据出图',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel = panel;
    panel.webview.html = renderChartHtml(panel.webview, this.snapshotState(), createNonce());

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

  private maxPoints(): number {
    const configured = vscode.workspace
      .getConfiguration('syscomtool')
      .get<number>('chart.maxPoints', 3000);
    return Math.max(100, Math.min(20000, Math.floor(configured)));
  }

  private snapshotState(): ChartPanelState | undefined {
    if (!this.dataset) {
      return undefined;
    }
    const preview = previewDataset(this.dataset, PREVIEW_ROWS);
    const defaults = inferDefaults(this.dataset);

    return {
      columns: this.dataset.columns,
      preview: preview.rows,
      total: preview.total,
      format: this.dataset.format,
      warnings: this.dataset.warnings,
      options: {
        ...defaults,
        type: 'line',
        sortByX: true,
        maxPoints: this.maxPoints(),
      },
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
      case 'render':
        this.render(message.options);
        return;
      case 'copySvg':
        await this.copySvg(message.svg);
        return;
      case 'saveSvg':
        await this.saveSvg(message.svg);
        return;
      case 'saveCsv':
        await this.saveCsv(message.options);
        return;
      default:
        this.deps.logger.debug(`未处理的图表消息：${type}`);
    }
  }

  private load(text: string): void {
    const result = parseTabularData(text);
    if (!result.ok) {
      this.post({ type: 'error', message: result.error });
      return;
    }

    this.dataset = result.dataset;
    this.deps.logger.info(
      `图表数据已载入：${result.dataset.rows.length} 行 × ${result.dataset.columns.length} 列` +
        `（${result.dataset.format}）`,
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
      const text = await fs.readFile(picked[0].fsPath, 'utf8');
      this.load(text);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn(`读取数据文件失败：${reason}`);
      this.post({ type: 'error', message: `读取失败：${reason}` });
    }
  }

  private normalizeOptions(raw: unknown): ChartOptions | undefined {
    if (!this.dataset) {
      return undefined;
    }
    const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const columns = this.dataset.columns;
    const defaults = inferDefaults(this.dataset);

    const toIndex = (value: unknown, fallback: number): number => {
      const index = Number(value);
      return Number.isInteger(index) && index >= 0 && index < columns.length ? index : fallback;
    };

    const xIndex = toIndex(source.xIndex, defaults.xIndex);
    const yIndex = toIndex(source.yIndex, defaults.yIndex);

    let groupIndex: number | undefined;
    if (source.groupIndex !== null && source.groupIndex !== undefined && source.groupIndex !== '') {
      const candidate = Number(source.groupIndex);
      if (
        Number.isInteger(candidate) &&
        candidate >= 0 &&
        candidate < columns.length &&
        candidate !== xIndex &&
        candidate !== yIndex
      ) {
        groupIndex = candidate;
      }
    }

    const type = CHART_TYPES.includes(source.type as ChartType)
      ? (source.type as ChartType)
      : 'line';

    return {
      xIndex,
      yIndex,
      groupIndex,
      type,
      sortByX: source.sortByX !== false,
      maxPoints: this.maxPoints(),
    };
  }

  private render(rawOptions: unknown): void {
    if (!this.dataset) {
      this.post({ type: 'error', message: '还没有数据：先粘贴内容或打开一个文件' });
      return;
    }

    const options = this.normalizeOptions(rawOptions);
    if (!options) {
      return;
    }

    const result = buildChartModel(this.dataset, options);
    if (!result.ok) {
      this.post({ type: 'error', message: result.error });
      return;
    }

    this.post({ type: 'chart', model: result.model });
  }

  private async copySvg(svg: unknown): Promise<void> {
    if (typeof svg !== 'string' || svg.trim() === '') {
      return;
    }
    await vscode.env.clipboard.writeText(svg);
    void vscode.window.setStatusBarMessage('SysComTool：SVG 已复制', 3000);
  }

  private async saveSvg(svg: unknown): Promise<void> {
    if (typeof svg !== 'string' || svg.trim() === '') {
      return;
    }

    const target = await vscode.window.showSaveDialog({
      saveLabel: '保存 SVG',
      filters: { SVG: ['svg'] },
      defaultUri: this.defaultUri('chart.svg'),
    });
    if (!target) {
      return;
    }

    try {
      await fs.writeFile(target.fsPath, svg, 'utf8');
      void vscode.window.showInformationMessage(`图表已保存：${target.fsPath}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`保存失败：${reason}`);
    }
  }

  private async saveCsv(rawOptions: unknown): Promise<void> {
    if (!this.dataset) {
      return;
    }
    const options = this.normalizeOptions(rawOptions);
    if (!options) {
      return;
    }

    const header = [
      this.dataset.columns[options.xIndex]?.name ?? 'x',
      this.dataset.columns[options.yIndex]?.name ?? 'y',
    ];
    if (options.groupIndex !== undefined) {
      header.push(this.dataset.columns[options.groupIndex]?.name ?? 'group');
    }
    const lines = [header.map(escapeCsv).join(',')];

    for (const row of this.dataset.rows) {
      const x = (row[options.xIndex] ?? '').trim();
      const yText = (row[options.yIndex] ?? '').trim();
      if (x === '' || toNumber(yText) === undefined) {
        continue;
      }
      const cells = [x, yText];
      if (options.groupIndex !== undefined) {
        cells.push((row[options.groupIndex] ?? '').trim());
      }
      lines.push(cells.map(escapeCsv).join(','));
    }

    const target = await vscode.window.showSaveDialog({
      saveLabel: '导出 CSV',
      filters: { CSV: ['csv'] },
      defaultUri: this.defaultUri('chart-data.csv'),
    });
    if (!target) {
      return;
    }

    try {
      await fs.writeFile(target.fsPath, lines.join('\n'), 'utf8');
      void vscode.window.showInformationMessage(`数据已导出：${target.fsPath}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`导出失败：${reason}`);
    }
  }

  private defaultUri(fileName: string): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? vscode.Uri.joinPath(folder.uri, fileName) : undefined;
  }
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
