import { serialize, deserialize } from '../../engine/v2/serializer';
import type { GameState } from '../../engine/v2/types';

export function saveState(state: GameState): void {
  const json = serialize(state);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sanguosha_${state.meta.createdAt}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function loadState(file: File): Promise<GameState> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = deserialize(reader.result as string);
        resolve(data);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
