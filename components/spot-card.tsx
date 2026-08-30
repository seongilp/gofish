'use client';

import { Moon, Waves, Wind } from 'lucide-react';

import { IndexBadge } from '@/components/index-badge';
import { formatRange, looksLikeMissingLow, type Slot, type Spot } from '@/lib/fishing';
import { cn } from '@/lib/utils';

/**
 * 랭킹 목록의 지점 카드.
 *
 * 한 슬롯(날짜+시간대)만 보여 준다. 카드 하나에 7일치를 우겨 넣으면 랭킹이 안 읽힌다.
 * 7일 추이는 상세 패널의 몫이다.
 */
export function SpotCard({
  spot,
  slot,
  rank,
  selected,
  onSelect,
}: {
  spot: Spot;
  slot: Slot;
  rank: number;
  selected: boolean;
  onSelect: (spot: Spot) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(spot)}
      aria-pressed={selected}
      className={cn(
        'bg-card/90 border-border hover:border-primary/50 focus-visible:ring-ring w-full rounded-xl border p-3 text-left backdrop-blur transition-colors focus-visible:ring-2 focus-visible:outline-none',
        selected && 'border-primary ring-primary/30 ring-1',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground w-6 shrink-0 pt-0.5 text-sm font-bold tabular-nums">
          {rank}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold">{spot.name}</span>
            <span className="text-muted-foreground shrink-0 text-[11px]">{spot.region}</span>
          </div>

          <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums">
            <span className="flex items-center gap-1">
              <Moon className="size-3 shrink-0" aria-hidden />
              {slot.tide || '—'}
            </span>
            <span className="flex items-center gap-1">
              <Waves className="size-3 shrink-0" aria-hidden />
              파고 {formatRange(slot.wave)}m
            </span>
            <span
              title={
                looksLikeMissingLow(slot.waterTemp)
                  ? '최저 수온이 원본에서 0.1℃ 로 온다. 결측을 채운 값으로 보이지만 원본 그대로 표시한다.'
                  : undefined
              }
            >
              수온 {formatRange(slot.waterTemp)}℃
              {looksLikeMissingLow(slot.waterTemp) && <span className="text-amber-400"> ?</span>}
            </span>
            <span className="flex items-center gap-1">
              <Wind className="size-3 shrink-0" aria-hidden />
              {formatRange(slot.wind)}m/s
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            {slot.fish.length > 0 ? (
              slot.fish.slice(0, 4).map((fish) => (
                <span
                  key={fish.name}
                  className="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 text-[10px]"
                >
                  {fish.name} <span className="opacity-70">{fish.index}</span>
                </span>
              ))
            ) : (
              /* 원해 지점은 대상어종이 `-` 로 온다. 없는 값을 지어내지 않는다. */
              <span className="text-muted-foreground text-[10px]">대상어종 정보 없음 (원해)</span>
            )}
            {slot.fish.length > 4 && (
              <span className="text-muted-foreground text-[10px]">+{slot.fish.length - 4}</span>
            )}
          </div>
        </div>

        <IndexBadge index={slot.bestIndex} />
      </div>
    </button>
  );
}
