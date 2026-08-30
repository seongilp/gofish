import { indexTone } from '@/lib/fishing';
import { cn } from '@/lib/utils';

/**
 * 지수 배지. 5단계를 색으로 구분한다.
 *
 * 5단계라 색만으로도 갈리지만, 색각 이상이나 흑백 인쇄에서 무너지므로
 * **글자를 반드시 함께 둔다**. 색은 보조다.
 */
export function IndexBadge({
  index,
  className,
  size = 'md',
}: {
  index: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const tone = indexTone(index);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        tone.bg,
        tone.text,
        className,
      )}
    >
      {index || '자료 없음'}
    </span>
  );
}
