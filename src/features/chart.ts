import type { Feature } from '../core/types';
import type { ChartPanel } from '../views/chartPanel';

/** 打开数据出图面板。 */
export function createChartFeature(panel: ChartPanel): Feature {
  return {
    id: 'syscomtool.chart',
    title: '数据出图',
    category: '数据分析',
    description: 'CSV / Markdown 表格 / 粘贴数据，选一个自变量与因变量出折线、平滑、散点、柱状、面积图',
    run(): void {
      panel.show();
    },
  };
}
