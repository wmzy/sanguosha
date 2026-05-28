// engine/prompt.ts
import type { Prompt, PromptType } from '../shared/types';

export function createPrompt(name: string, playerName: string, options: unknown[]): Prompt {
  let type: PromptType = 'select_option';

  if (name === '选择目标' || name === '选择玩家') {
    type = 'select_player';
  } else if (options.length === 2 && options.includes('是') && options.includes('否')) {
    type = 'select_yes_no';
  } else if (name === '出牌' || name === '选择卡牌' || name === '弃牌') {
    type = 'select_card';
  }

  return {
    name,
    description: `请为 ${playerName} 做出选择`,
    type,
    options,
  };
}

export function handleResponse(prompt: Prompt, response: unknown): boolean {
  return prompt.options.includes(response);
}
