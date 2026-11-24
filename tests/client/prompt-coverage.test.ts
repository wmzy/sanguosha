// tests/client/prompt-coverage.test.ts
// 契约:引擎声明的每种 prompt 类型,浏览器与无头两侧都必须登记处理位置。
// 编译期部分:两侧表都是 Record<PromptType, …>,新增 prompt 类型会直接 tsc 报错。
// 运行期部分(本文件):两侧表不得多登记/少登记引擎清单。
import { describe, it, expect } from 'vitest';
import { PROMPT_TYPES } from '../../src/engine/types';
import { BROWSER_PROMPTS } from '../../src/client/view/promptCoverage';
import { HEADLESS_PROMPTS } from '../../src/client/headless/promptCoverage';

describe('prompt 类型覆盖契约', () => {
  it('浏览器侧覆盖表与引擎清单完全一致', () => {
    expect(Object.keys(BROWSER_PROMPTS).sort()).toEqual([...PROMPT_TYPES].sort());
  });

  it('无头侧覆盖表与引擎清单完全一致', () => {
    expect(Object.keys(HEADLESS_PROMPTS).sort()).toEqual([...PROMPT_TYPES].sort());
  });

  it('每种 prompt 都登记了处理位置(非空描述)', () => {
    for (const type of PROMPT_TYPES) {
      expect(BROWSER_PROMPTS[type], `浏览器缺 ${type}`).toBeTruthy();
      expect(HEADLESS_PROMPTS[type], `无头缺 ${type}`).toBeTruthy();
    }
  });
});
