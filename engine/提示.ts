// engine/提示.ts
import type { Prompt, PromptType } from '../shared/类型';

export function 创建提示(name: string, 玩家名: string, 选项: unknown[]): Prompt {
  let 类型: PromptType = 'select_option';

  if (name === '选择目标' || name === '选择玩家') {
    类型 = 'select_player';
  } else if (选项.length === 2 && 选项.includes('是') && 选项.includes('否')) {
    类型 = 'select_yes_no';
  } else if (name === '出牌' || name === '选择卡牌' || name === '弃牌') {
    类型 = 'select_card';
  }

  return {
    name,
    描述: `请为 ${玩家名} 做出选择`,
    类型,
    选项,
  };
}

export function 处理响应(提示: Prompt, 响应: unknown): boolean {
  return 提示.选项.includes(响应);
}
