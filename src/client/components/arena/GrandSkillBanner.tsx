import { useEffect, useRef, useState } from 'react';
import { getCharacterImage } from '../../assets/imageAssets';

export interface GrandSkillItem {
  id?: string;
  skillName: string;
  characterName: string;
  faction?: string;
}

export interface GrandSkillBannerProps {
  skill?: GrandSkillItem | null;
  current?: GrandSkillItem | null;
  queue?: GrandSkillItem[];
  duration?: number;
  onDismiss?: (item: GrandSkillItem) => void;
}

function formatSkillName(name: string): string {
  const clean = name.replace(/[〔〕【】\s]/g, '');
  return clean.split('').join(' ');
}

/**
 * 电影级水墨黑金技能大特写 (GrandSkillBanner)
 * 包含武将切片立绘金环、烫金毛笔大字技能名（如〔 界 制 衡 〕）、水墨气劲冲击波与流光。
 * 持续 1.8 秒，支持连续发动平滑排队，pointer-events: none 不阻挡牌桌操作。
 */
export function GrandSkillBanner({
  skill,
  current,
  queue,
  duration = 1800,
  onDismiss,
}: GrandSkillBannerProps) {
  const directItem = skill ?? current ?? null;
  const [activeItem, setActiveItem] = useState<GrandSkillItem | null>(directItem);

  const queueRef = useRef<GrandSkillItem[]>([]);
  queueRef.current = queue ?? [];

  const processedRef = useRef<Set<GrandSkillItem | string>>(new Set());

  useEffect(() => {
    if (directItem) {
      setActiveItem(directItem);
    }
  }, [directItem]);

  useEffect(() => {
    if (directItem) return;
    if (!activeItem && queue && queue.length > 0) {
      const nextItem = queue.find(
        (item) => !processedRef.current.has(item) && (!item.id || !processedRef.current.has(item.id)),
      );
      if (nextItem) {
        setActiveItem(nextItem);
      }
    }
  }, [queue, activeItem, directItem]);

  useEffect(() => {
    if (!activeItem) return;

    const timer = setTimeout(() => {
      const finished = activeItem;
      processedRef.current.add(finished);
      if (finished.id) {
        processedRef.current.add(finished.id);
      }
      onDismiss?.(finished);

      const nextItem = (queueRef.current ?? []).find(
        (item) => !processedRef.current.has(item) && (!item.id || !processedRef.current.has(item.id)),
      );

      setActiveItem(nextItem ?? null);
    }, duration);

    return () => clearTimeout(timer);
  }, [activeItem, duration, onDismiss]);

  if (!activeItem) return null;

  const { skillName, characterName, faction } = activeItem;
  const portrait = getCharacterImage(characterName);
  const formattedName = formatSkillName(skillName);

  return (
    <aside
      className="arena-grand-skill-banner"
      data-testid="grand-skill-banner"
      style={{ pointerEvents: 'none' }}
      aria-live="polite"
    >
      <div className="grand-skill-shockwave" aria-hidden="true">
        <svg
          className="grand-skill-ink-svg"
          viewBox="0 0 1000 240"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <radialGradient id="grandInkCore" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffd700" stopOpacity="0.45" />
              <stop offset="50%" stopColor="#d4a94b" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="grandGoldBeam" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="20%" stopColor="#ffd700" stopOpacity="0.8" />
              <stop offset="50%" stopColor="#fff8db" stopOpacity="1" />
              <stop offset="80%" stopColor="#ffd700" stopOpacity="0.8" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
            <filter id="grandGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <ellipse cx="500" cy="120" rx="460" ry="85" fill="url(#grandInkCore)" />
          <path
            className="grand-shockwave-wave grand-wave-1"
            d="M 120 120 Q 500 35 880 120 Q 500 205 120 120 Z"
            stroke="url(#grandGoldBeam)"
            strokeWidth="3"
            fill="none"
            filter="url(#grandGlow)"
          />
          <path
            className="grand-shockwave-wave grand-wave-2"
            d="M 220 120 Q 500 65 780 120 Q 500 175 220 120 Z"
            stroke="#f4d88c"
            strokeWidth="1.5"
            strokeDasharray="8 4"
            fill="none"
            opacity="0.85"
          />
          <circle cx="180" cy="90" r="3" fill="#ffd700" opacity="0.65" className="grand-ink-particle p1" />
          <circle cx="260" cy="150" r="2.5" fill="#e5a93b" opacity="0.75" className="grand-ink-particle p2" />
          <circle cx="740" cy="85" r="3.5" fill="#ffd700" opacity="0.65" className="grand-ink-particle p3" />
          <circle cx="820" cy="145" r="2" fill="#e5a93b" opacity="0.75" className="grand-ink-particle p4" />
          <line x1="60" y1="120" x2="940" y2="120" stroke="url(#grandGoldBeam)" strokeWidth="1.2" opacity="0.8" />
        </svg>
      </div>

      <div className="grand-skill-banner-inner">
        <div className="grand-skill-avatar-wrap">
          <div className="grand-skill-gold-ring" aria-hidden="true" />
          {portrait ? (
            <img
              className="grand-skill-avatar"
              src={portrait}
              alt={characterName}
              onError={(e) => {
                e.currentTarget.style.visibility = 'hidden';
              }}
            />
          ) : (
            <div className="grand-skill-avatar-placeholder">
              {characterName ? characterName.slice(0, 1) : '将'}
            </div>
          )}
        </div>

        <div className="grand-skill-content">
          <div className="grand-skill-top-tag">
            <span className="grand-skill-badge">绝技发动</span>
            <span className="grand-skill-hero-meta">
              {faction && <span className={`grand-skill-faction faction-${faction}`}>{faction}</span>}
              <strong className="grand-skill-character-name">{characterName}</strong>
            </span>
          </div>
          <div className="grand-skill-title-wrap">
            <h2
              className="grand-skill-name"
              data-testid="grand-skill-name"
              aria-label={`技能：${skillName}`}
            >
              〔 {formattedName} 〕
            </h2>
            <span
              className="grand-skill-sr-text"
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
            >
              {skillName}
            </span>
          </div>
          <div className="grand-skill-meta-desc">
            {characterName} 发动【{skillName}】
          </div>
          <div className="grand-skill-aura-bar" aria-hidden="true" />
        </div>
      </div>
    </aside>
  );
}
