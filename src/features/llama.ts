import type { Feature } from '../core/types';
import type { LlamaPanel } from '../views/llamaPanel';

/** 打开图形化 llama.cpp 面板（编辑器标签页形态）。 */
export function createLlamaFeature(panel: LlamaPanel): Feature {
  return {
    id: 'syscomtool.llama',
    title: '图形化 llama.cpp',
    category: 'llama',
    description: '选编译好的 llama.cpp、挑模型、设参数，预览命令并并行运行多个任务',
    requires: ['llama.cpp 构建产物', 'GGUF 模型'],
    run(): void {
      panel.show();
    },
  };
}
