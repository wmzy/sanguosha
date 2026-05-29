import type { GameState, PlayerAction, TurnPhase } from '../../shared/types';

export interface ValidationContext {
  game: GameState;
  player: string;
  action: PlayerAction;
  phase: TurnPhase;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export type Validator = (ctx: ValidationContext) => ValidationResult | null;

export class ValidationPipeline {
  private validators: Validator[] = [];

  addValidator(v: Validator): void {
    this.validators.push(v);
  }

  validate(ctx: ValidationContext): ValidationResult {
    for (const v of this.validators) {
      const result = v(ctx);
      if (result && !result.valid) {
        return result;
      }
    }
    return { valid: true };
  }
}

export function phaseValidator(ctx: ValidationContext): ValidationResult | null {
  const { action, phase } = ctx;
  if (action.type === '出牌' && phase !== '出牌') {
    return { valid: false, reason: '当前阶段不能出牌' };
  }
  if (action.type === '结束回合' && phase !== '出牌') {
    return { valid: false, reason: '当前阶段不能结束回合' };
  }
  return null;
}

export function targetValidator(ctx: ValidationContext): ValidationResult | null {
  const { action, player } = ctx;
  if (action.type === '出牌' && action.target) {
    if (action.card.name === '杀' && action.target === player) {
      return { valid: false, reason: '不能对自己使用杀' };
    }
    const target = ctx.game.players.find(p => p.name === action.target);
    if (!target?.alive) {
      return { valid: false, reason: '目标不存在或已死亡' };
    }
  }
  return null;
}
