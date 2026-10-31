import type { Feature } from '../core/types';
import type { UpdateFlow } from '../services/update/updateFlow';
import type { LlamaPanel } from '../views/llamaPanel';
import { helloFeature } from './hello';
import { createLlamaFeature } from './llama';
import { createUpdateFeature } from './update';

export interface FeatureDeps {
  panel: LlamaPanel;
  updateFlow: UpdateFlow;
}

/**
 * 内置功能清单（按工厂函数组装，依赖从这里注入）。
 *
 * 新增功能时：
 * 1. 在 `src/features/` 下新建文件并导出 `Feature`（或返回 Feature 的工厂）；
 * 2. 加到下面的数组；
 * 3. 在 `package.json` 的 `contributes.commands` 里声明同 id 的命令。
 */
export function createFeatures(deps: FeatureDeps): Feature[] {
  return [
    helloFeature,
    createLlamaFeature(deps.panel),
    createUpdateFeature(() => {
      void deps.updateFlow.check({ interactive: true });
    }),
  ];
}
