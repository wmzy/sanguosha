import { memo } from 'react';
import { css } from '@linaria/core';
import { colors, styles } from '../../theme';
import type { AvailableSkill } from '../../../engine/types';

interface SkillButtonsProps {
  availableSkills: AvailableSkill[];
  onActivate: (skillId: string) => void;
}

const bottomButtonsRow = css`
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-bottom: 12px;
`;

const skillBtnPadding = css`
  padding: 6px 16px;
  font-size: 13px;
`;

export const SkillButtons = memo(({
  availableSkills,
  onActivate,
}: SkillButtonsProps) => {
  if (availableSkills.length === 0) return null;
  return (
    <div className={bottomButtonsRow}>
      {availableSkills.map((skill) => (
        <button
          key={skill.skillId}
          onClick={() => onActivate(skill.skillId)}
          className={skillBtnPadding}
          style={styles.btn(colors.accent.orange)}
        >
          发动 {skill.name}
        </button>
      ))}
    </div>
  );
});
