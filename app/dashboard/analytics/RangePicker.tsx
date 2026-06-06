'use client';
import { useRouter } from 'next/navigation';

const OPTIONS = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_30',    label: 'Last 30 days' },
];

export default function RangePicker({ current }: { current: string }) {
  const router = useRouter();
  return (
    <select
      defaultValue={current}
      onChange={(e) => router.replace(`/dashboard/analytics?range=${e.target.value}`)}
      style={{
        border: '1px solid var(--line)',
        background: 'white',
        borderRadius: 10,
        padding: '8px 12px',
        fontSize: 13,
        color: 'var(--ink)',
        fontFamily: 'inherit',
      }}
    >
      {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
