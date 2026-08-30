'use client';

import { MapPin, X } from 'lucide-react';

import { IndexBadge } from '@/components/index-badge';
import {
  formatDate,
  formatDateShort,
  formatRange,
  indexTone,
  looksLikeMissingLow,
  relativeDay,
  type NoonCode,
  type Slot,
  type Spot,
} from '@/lib/fishing';
import { cn } from '@/lib/utils';

/** 상세 수치 한 줄. 라벨은 작고 흐리게, 값은 크고 tabular-nums 로. */
function Stat({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
}) {
  return (
    <div className="bg-secondary/50 rounded-lg px-2.5 py-2" title={note}>
      <div className="text-muted-foreground text-[10px]">
        {label}
        {note && <span className="text-amber-400"> ?</span>}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">
        {value}
        {unit && value !== '—' && <span className="text-muted-foreground ml-0.5 text-[10px] font-normal">{unit}</span>}
      </div>
    </div>
  );
}

const NOON_SHORT: Record<NoonCode, string> = { 오전: '오전', 오후: '오후', 일: '종일' };

/**
 * 히트맵 칸에 넣을 축약. 열이 10개라 320px 남짓한 패널에서 두 글자가 한계다.
 * 전체 이름은 칸의 title 과 아래 상세 헤더에서 볼 수 있다.
 */
const INDEX_SHORT: Record<string, string> = {
  매우좋음: '매좋',
  좋음: '좋음',
  보통: '보통',
  나쁨: '나쁨',
  매우나쁨: '매나',
};

/**
 * 7일 추이 히트맵.
 *
 * 행은 대표지수(어종 중 최고) + 어종별, 열은 슬롯이다.
 * **열 개수가 7이 아니라 10이다** — 첫 3일만 오전/오후로 갈리고 나머지 4일은 종일 하나뿐이다.
 * 그래서 열 폭을 날짜로 균등 분할하지 않고 슬롯 단위로 깐 뒤 날짜 헤더를 colSpan 으로 묶는다.
 */
function Heatmap({
  slots,
  activeKey,
  today,
  onPick,
}: {
  slots: Slot[];
  activeKey: string;
  today: string;
  onPick: (slot: Slot) => void;
}) {
  // 날짜별 슬롯 수를 세어 헤더를 묶는다.
  const days: { date: string; count: number }[] = [];
  for (const slot of slots) {
    const last = days.at(-1);
    if (last && last.date === slot.date) last.count += 1;
    else days.push({ date: slot.date, count: 1 });
  }

  const fishNames = [...new Set(slots.flatMap((slot) => slot.fish.map((f) => f.name)))];

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[318px] table-fixed border-separate border-spacing-0.5 text-center">
        <thead>
          <tr>
            <th className="w-11" />
            {days.map((day) => (
              <th
                key={day.date}
                colSpan={day.count}
                className="text-muted-foreground pb-1 text-[10px] font-medium whitespace-nowrap"
              >
                {relativeDay(day.date, today) ?? formatDateShort(day.date)}
              </th>
            ))}
          </tr>
          <tr>
            <th className="w-11" />
            {slots.map((slot) => (
              <th
                key={`${slot.date}|${slot.noon}`}
                className="text-muted-foreground pb-1 text-[9px] font-normal whitespace-nowrap"
              >
                {NOON_SHORT[slot.noon]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="text-muted-foreground pr-1 text-left text-[10px] font-medium whitespace-nowrap">
              대표
            </th>
            {slots.map((slot) => {
              const key = `${slot.date}|${slot.noon}`;
              const tone = indexTone(slot.bestIndex);
              return (
                <td key={key} className="p-0">
                  <button
                    type="button"
                    onClick={() => onPick(slot)}
                    title={`${formatDate(slot.date)} ${NOON_SHORT[slot.noon]} · ${slot.bestIndex || '자료 없음'}`}
                    className={cn(
                      'h-7 w-full rounded text-[9px] font-semibold transition-opacity hover:opacity-80',
                      tone.bg,
                      tone.text,
                      key === activeKey && 'ring-primary ring-2',
                    )}
                  >
                    {INDEX_SHORT[slot.bestIndex] ?? ''}
                  </button>
                </td>
              );
            })}
          </tr>
          {fishNames.map((name) => (
            <tr key={name}>
              <th className="text-muted-foreground pr-1 text-left text-[10px] font-normal whitespace-nowrap">
                {name}
              </th>
              {slots.map((slot) => {
                const fish = slot.fish.find((f) => f.name === name);
                const tone = indexTone(fish?.index ?? '');
                return (
                  <td key={`${slot.date}|${slot.noon}`} className="p-0">
                    <div
                      title={fish ? `${name} · ${fish.index}` : '자료 없음'}
                      className={cn('h-5 rounded', !fish && 'bg-muted/40')}
                      style={fish ? { backgroundColor: tone.hex } : undefined}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SpotDetail({
  spot,
  slot,
  today,
  onPickSlot,
  onClose,
}: {
  spot: Spot;
  slot: Slot;
  today: string;
  onPickSlot: (slot: Slot) => void;
  onClose: () => void;
}) {
  const activeKey = `${slot.date}|${slot.noon}`;

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-start gap-2 border-b p-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold">{spot.name}</h2>
          <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[11px] tabular-nums">
            <MapPin className="size-3 shrink-0" aria-hidden />
            {spot.region} · {spot.lat.toFixed(3)}N {spot.lon.toFixed(3)}E
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg p-1.5 transition-colors"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <h3 className="text-muted-foreground mb-2 text-xs font-medium">7일 추이</h3>
          <Heatmap slots={spot.slots} activeKey={activeKey} today={today} onPick={onPickSlot} />
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-muted-foreground text-xs font-medium">
              {formatDate(slot.date)} {NOON_SHORT[slot.noon]}
            </h3>
            <IndexBadge index={slot.bestIndex} size="sm" />
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <Stat label="물때" value={slot.tide || '—'} />
            <Stat label="파고" value={formatRange(slot.wave)} unit="m" />
            <Stat
              label="수온"
              value={formatRange(slot.waterTemp)}
              unit="℃"
              note={
                looksLikeMissingLow(slot.waterTemp)
                  ? '최저 수온이 원본에서 0.1℃ 로 온다. 결측을 채운 값으로 보이지만 원본 그대로 표시한다.'
                  : undefined
              }
            />
            <Stat label="기온" value={formatRange(slot.airTemp)} unit="℃" />
            <Stat label="유속" value={formatRange(slot.current, 2)} unit="m/s" />
            <Stat label="풍속" value={formatRange(slot.wind)} unit="m/s" />
          </div>
        </section>

        <section>
          <h3 className="text-muted-foreground mb-2 text-xs font-medium">대상어종별 지수</h3>
          {slot.fish.length > 0 ? (
            <ul className="space-y-1">
              {slot.fish.map((fish) => (
                <li
                  key={fish.name}
                  className="bg-secondary/50 flex items-center justify-between rounded-lg px-2.5 py-1.5"
                >
                  <span className="text-xs">{fish.name}</span>
                  <IndexBadge index={fish.index} size="sm" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-[11px]">
              이 지점은 대상어종 정보를 제공하지 않는다. 연안에서 떨어진 원해 예보 지점이라
              원본 응답의 대상어종이 비어 있다 — 지수·해황 수치는 정상이다.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
