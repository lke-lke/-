import { Rate } from 'antd';
import { DIFFICULTY_POINTS } from '@/constants';

interface Props {
  value?: number;
  onChange?: (val: number) => void;
  readOnly?: boolean;
}

export default function DifficultyStars({ value, onChange, readOnly = true }: Props) {
  return (
    <span>
      <Rate
        count={5}
        value={value}
        onChange={onChange}
        disabled={readOnly}
        style={{ fontSize: 14 }}
      />
      {value && <span style={{ marginLeft: 8, color: 'var(--ink-soft)', fontSize: 12 }}>({DIFFICULTY_POINTS[value]}点)</span>}
    </span>
  );
}
