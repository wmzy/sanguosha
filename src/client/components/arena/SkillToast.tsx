import React from 'react';

export interface SkillToastProps {
  skillName: string;
  characterName: string;
}

/**
 * 统一武将技能发动横幅提醒 (SkillToast)
 * 当检测到武将发动技能时，在武将座次上方弹出持续 1.5s 的水墨金边横幅（〔技能名〕· 武将名）。
 */
export function SkillToast({ skillName, characterName }: SkillToastProps) {
  return (
    <div className="arena-skill-toast" data-testid="arena-skill-toast">
      <div className="arena-skill-toast-inner">
        <span className="arena-skill-toast-badge">技能</span>
        <span className="arena-skill-toast-text">
          〔{skillName}〕· {characterName}
        </span>
      </div>
    </div>
  );
}
