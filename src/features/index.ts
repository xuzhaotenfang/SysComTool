import type { Feature } from '../core/types';
import { helloFeature } from './hello';

/**
 * 内置功能清单。
 *
 * 新增功能时：
 * 1. 在 `src/features/` 下新建文件并导出 `Feature`；
 * 2. 加到下面这个数组；
 * 3. 在 `package.json` 的 `contributes.commands` 里声明同 id 的命令。
 */
export const FEATURES: readonly Feature[] = [helloFeature];
