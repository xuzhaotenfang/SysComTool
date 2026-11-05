import type { Feature } from '../core/types';
import type { FormulaPanel } from '../views/formulaPanel';

/** 打开建模计算面板：LaTeX 公式 + CSV → 结果列。 */
export function createFormulaFeature(panel: FormulaPanel): Feature {
  return {
    id: 'syscomtool.formula',
    title: '建模计算',
    category: '数据分析',
    description: '把建模公式（LaTeX）套到 CSV 上：因子绑列或取常量，逐行算出新列，可导出或直接出图',
    run(): void {
      panel.show();
    },
  };
}
