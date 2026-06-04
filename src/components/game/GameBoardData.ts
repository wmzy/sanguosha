import type {
  PlayerState,
  ValidAction,
  Json,
  PendingAction,
  PlayableCard,
  AvailableSkill,
} from '../../../engine/types';
import type { Card } from '../../../shared/types';
import type { Operation } from '../../../shared/log';
import type { PlayerPanelData } from '../PlayerPanel';

export interface PlayerEntry {
  name: string;
  panelData: PlayerPanelData;
  characterId: string;
  role: string;
  alive: boolean;
}

export interface GameBoardData {
  state: import('../../../engine/types').GameState;
  cardMap: Record<string, Card>;
  me: PlayerState;
  myName: string;
  playerOrder: string[];
  isMyTurn: boolean;
  selectedCardId: string | null;
  selectedCardIndex: number | null;
  selectCard: (cardId: string | null) => void;
  selectedTarget: string | null;
  setSelectedTarget: (target: string | null) => void;
  canPlay: boolean;
  validActions: ValidAction[];
  playableCards: PlayableCard[];
  playableCardIds: Set<string>;
  needsTarget: boolean;
  validTargetList: string[];
  handlePlayCard: () => void;
  handleEndTurn: () => void;
  needsDiscard: boolean;
  discardCount: number;
  discardCards: string[];
  selectedForDiscard: Set<string>;
  toggleDiscardSelection: (cardId: string) => void;
  handleDiscard: () => void;
  pendingPrompt: import('./Prompts').PendingPromptData | null;
  hasDodge: boolean;
  respondAction: Extract<ValidAction, { type: 'respond' }> | undefined;
  respondToKill: (playDodge: boolean) => void;
  respond: (cardId?: string) => void;
  respondToDying: (saverName: string | null) => void;
  selectTargetCard: (cardId: string) => void;
  selectHarvestCard: (cardId: string) => void;
  availableSkills: AvailableSkill[];
  handleActivateSkill: (skillId: string, target?: string) => void;
  selectedSkillCards: Set<string>;
  toggleSkillCardSelection: (cardId: string) => void;
  handleSkillChoice: (choice: Json) => void;
  myHand: Card[];
  orderedPlayers: PlayerEntry[];
  switchPerspective: () => void;
  setPerspective: (playerName: string) => void;
  goToCurrentPlayer: () => void;
  handleSaveLog: () => void;
  toggleAutoSkipWuxie: () => void;
  getDistance: (from: string, to: string) => number;
  pending: PendingAction | null;
  playerOps: Operation[];
}
