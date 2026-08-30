'use client';

import { AlertTriangle, Fish, Info, List, Map as MapIcon, RefreshCw } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { BottomSheet, SNAP_RATIO, type SheetSnap } from '@/components/bottom-sheet';
import { SpotCard } from '@/components/spot-card';
import { SpotDetail } from '@/components/spot-detail';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsCompact } from '@/lib/use-media-query';
import {
  formatDate,
  INDEX_LABELS,
  indexTone,
  REGIONS,
  relativeDay,
  todayKst,
  type DayOption,
  type NoonCode,
  type Region,
  type Slot,
  type Spot,
} from '@/lib/fishing';
import { cn } from '@/lib/utils';

interface Forecast {
  spots: Spot[];
  days: DayOption[];
  fish: string[];
  recordCount: number;
  fetchedAt: string;
}

/*
 * maplibre 는 무겁고 window 에 의존한다. 지도 보기를 열기 전에는 받지 않도록
 * ssr:false 로 지연 로딩한다. 기본이 목록 보기라 대부분의 사용자는 아예 안 받는다.
 */
const SpotMap = dynamic(() => import('@/components/spot-map').then((m) => m.SpotMap), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-xl" />,
});

const NOON_LABEL: Record<NoonCode, string> = { 오전: '오전', 오후: '오후', 일: '종일' };

type View = 'list' | 'map';

/** 필터 칩. 이 화면의 조작은 전부 칩이라 하나로 통일한다. */
function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'focus-visible:ring-ring shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card/60 text-muted-foreground hover:text-foreground hover:border-foreground/30',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function FishingBrowser() {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [dayIndex, setDayIndex] = useState(0);
  const [noon, setNoon] = useState<NoonCode>('오전');
  const [region, setRegion] = useState<Region | ''>('');
  const [fish, setFish] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* 모바일에서 점을 정확히 누르기 어려우니 목록을 기본으로 둔다. */
  const [view, setView] = useState<View>('list');
  /** 상세 히트맵에서 다른 슬롯을 눌렀을 때만 쓴다. 목록 슬롯과 독립적으로 움직인다. */
  const [detailSlotKey, setDetailSlotKey] = useState<string | null>(null);
  /** 좁은 화면 + 지도 보기에서 상세를 담는 바텀시트의 높이 단계. */
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('peek');

  /*
   * 상세를 우측 패널로 붙일지 시트/모달로 띄울지를 CSS 가 아니라 렌더로 가른다.
   * `xl:hidden` 으로 숨기면 양쪽 SpotDetail 이 항상 같이 마운트된다.
   */
  const isCompact = useIsCompact();

  /*
   * 상세를 닫는 유일한 경로. 닫으면서 시트 높이도 peek 으로 되돌린다 —
   * 다음에 다른 지점을 골랐을 때 항상 지도가 보이는 상태로 열려야 하기 때문이다.
   * 닫는 갈래가 Esc·배경 탭·× 버튼·아래로 끌기 네 가지라 한 곳으로 모은다.
   */
  const closeDetail = useCallback(() => {
    setSelectedId(null);
    setSheetSnap('peek');
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    // effect 본문에서 동기 setState 를 하면 연쇄 렌더가 난다. async 경계 뒤로 미룬다.
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/forecast', { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? '조회 실패');
        if (controller.signal.aborted) return;
        setForecast(body as Forecast);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : '조회 실패');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void load();
    return () => controller.abort();
  }, [reloadKey]);

  // 상세를 Esc 로 닫는다. 모바일 시트는 배경 탭으로도 닫히지만 키보드 사용자에겐 출구가 없다.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDetail]);

  const days = forecast?.days ?? [];
  const day = days[Math.min(dayIndex, Math.max(days.length - 1, 0))];

  /**
   * 고른 날짜에 없는 시간대는 조용히 되돌린다.
   *
   * 뒤쪽 4일은 오전/오후가 없고 종일(`일`) 하나뿐이다. 오전을 켜 둔 채 5일 뒤를 고르면
   * 목록이 통째로 비어 버린다 — 데이터가 없는 게 아니라 시간대가 없는 것이라 오해를 부른다.
   */
  const effectiveNoon: NoonCode = day
    ? day.noons.includes(noon)
      ? noon
      : (day.noons[0] ?? '일')
    : '일';

  /** 목록에 쓰는 (지점, 슬롯) 쌍. 필터·정렬을 여기서 한 번에 끝낸다. */
  const ranked = useMemo(() => {
    if (!forecast || !day) return [] as { spot: Spot; slot: Slot; score: number; index: string }[];

    const rows: { spot: Spot; slot: Slot; score: number; index: string }[] = [];
    for (const spot of forecast.spots) {
      if (region && spot.region !== region) continue;
      const slot = spot.slots.find((s) => s.date === day.date && s.noon === effectiveNoon);
      if (!slot) continue;

      // 어종을 고르면 그 어종의 지수로 줄을 세운다. 없는 지점은 목록에서 뺀다.
      if (fish) {
        const hit = slot.fish.find((f) => f.name === fish);
        if (!hit) continue;
        rows.push({ spot, slot, score: hit.score, index: hit.index });
      } else {
        rows.push({ spot, slot, score: slot.bestScore, index: slot.bestIndex });
      }
    }

    return rows.sort((a, b) => b.score - a.score || a.spot.name.localeCompare(b.spot.name, 'ko'));
  }, [forecast, day, effectiveNoon, region, fish]);

  const selected = forecast?.spots.find((spot) => spot.id === selectedId) ?? null;
  const detailSlot =
    selected &&
    (selected.slots.find((s) => `${s.date}|${s.noon}` === detailSlotKey) ??
      selected.slots.find((s) => s.date === day?.date && s.noon === effectiveNoon) ??
      selected.slots[0]);

  const today = todayKst();
  /** 5단계 분포. "오늘 전국이 대체로 어떤가" 를 한 줄로 보여 준다. */
  const distribution = INDEX_LABELS.map((label) => ({
    label,
    count: ranked.filter((row) => row.index === label).length,
  })).filter((entry) => entry.count > 0);

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pb-10">
      <header className="bg-background/80 sticky top-0 z-30 -mx-4 px-4 pt-4 pb-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Fish className="text-primary size-5 shrink-0" aria-hidden />
          <h1 className="text-base font-bold">
            gofish <span className="text-muted-foreground font-normal">바다낚시지수</span>
          </h1>
          <div className="border-border bg-card/60 ml-auto flex items-center gap-0.5 rounded-full border p-0.5">
            <button
              type="button"
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
              className={cn(
                'flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                view === 'list'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <List className="size-3.5" aria-hidden />
              목록
            </button>
            <button
              type="button"
              onClick={() => setView('map')}
              aria-pressed={view === 'map'}
              className={cn(
                'flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                view === 'map'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <MapIcon className="size-3.5" aria-hidden />
              지도
            </button>
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            aria-label="새로고침"
            className="text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg p-1.5 transition-colors"
          >
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden />
          </button>
        </div>

        {/* 날짜 — 가로 스크롤. 좁은 화면에서도 7일 전부에 손이 닿아야 한다. */}
        <div className="mt-3 -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {days.map((option, index) => {
            const relative = relativeDay(option.date, today);
            return (
              <Chip
                key={option.date}
                active={option.date === day?.date}
                onClick={() => {
                  setDayIndex(index);
                  setDetailSlotKey(null);
                }}
              >
                {relative ?? formatDate(option.date)}
              </Chip>
            );
          })}
          {days.length === 0 &&
            Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-8 w-16 shrink-0 rounded-full" />
            ))}
        </div>

        <div className="mt-2 -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {/* 시간대 — 뒤쪽 4일은 종일 하나뿐이라 그 날짜에 있는 것만 그린다. */}
          {(day?.noons ?? []).map((code) => (
            <Chip
              key={code}
              active={code === effectiveNoon}
              onClick={() => {
                setNoon(code);
                setDetailSlotKey(null);
              }}
            >
              {NOON_LABEL[code]}
            </Chip>
          ))}

          {day && day.noons.length > 0 && <span className="border-border mx-0.5 shrink-0 border-l" />}

          <Chip active={region === ''} onClick={() => setRegion('')}>
            전 해역
          </Chip>
          {REGIONS.map((name) => (
            <Chip key={name} active={region === name} onClick={() => setRegion(name)}>
              {name}
            </Chip>
          ))}
        </div>

        {(forecast?.fish.length ?? 0) > 0 && (
          <div className="mt-2 -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
            <Chip active={fish === ''} onClick={() => setFish('')}>
              어종 전체
            </Chip>
            {forecast!.fish.map((name) => (
              <Chip key={name} active={fish === name} onClick={() => setFish(name)}>
                {name}
              </Chip>
            ))}
          </div>
        )}
      </header>

      {error && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive-foreground mb-4 flex items-start gap-2 rounded-xl border p-3 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">예보를 불러오지 못했습니다.</p>
            <p className="text-muted-foreground mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* 분포 막대 — 오늘 전국이 대체로 어떤지 한 줄로. */}
      {distribution.length > 0 && (
        <div className="mb-3">
          <div className="flex h-1.5 overflow-hidden rounded-full">
            {distribution.map((entry) => (
              <div
                key={entry.label}
                className="h-full"
                style={{
                  width: `${(entry.count / ranked.length) * 100}%`,
                  backgroundColor: indexTone(entry.label).hex,
                }}
                title={`${entry.label} ${entry.count}곳`}
              />
            ))}
          </div>
          <div className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
            {distribution.map((entry) => (
              <span key={entry.label} className="flex items-center gap-1">
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: indexTone(entry.label).hex }}
                />
                {entry.label} {entry.count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-1 gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground mb-2 text-xs tabular-nums">
            {loading ? '불러오는 중…' : `${ranked.length}곳`}
            {!loading && day && (
              <>
                {' · '}
                {formatDate(day.date)} {NOON_LABEL[effectiveNoon]}
                {fish && ` · ${fish} 기준`}
              </>
            )}
          </p>

          {/*
            * 지도 보기. 목록과 **같은 `ranked`** 를 넘긴다 — 날짜·시간대·해역·어종 필터가
            * 그대로 적용되고, 어종을 고르면 그 어종 지수로 색이 바뀐다.
            * 지도가 스스로 필터링하면 두 화면이 어긋날 수 있어 순위 계산은 한 곳에만 둔다.
            */}
          {view === 'map' && (
            /* relative — 아래 바텀시트가 이 상자를 기준으로 자리를 잡는다.
               positioned 조상이 없으면 absolute 가 뷰포트로 올라붙어 헤더까지 덮는다. */
            <div className="border-border relative h-[calc(100dvh-19rem)] min-h-[380px] overflow-hidden rounded-xl border">
              {loading ? <Skeleton className="size-full" /> : (
                <SpotMap
                  rows={ranked}
                  selectedId={selectedId}
                  onSelect={(spot) => {
                    setSelectedId(spot.id);
                    setDetailSlotKey(null);
                  }}
                  compact={isCompact}
                  bottomInsetRatio={isCompact && selected ? SNAP_RATIO[sheetSnap] : 0}
                />
              )}

              {/*
                좁은 화면: 상세를 전체 화면 모달이 아니라 지도 상자 안의 바텀시트로 띄운다.
                지도를 보면서 옆 지점으로 옮겨가는 게 지도 보기의 존재 이유인데, 예전처럼
                `fixed inset-0` 으로 덮으면 지점 하나 볼 때마다 시트를 닫아야 했다.
                손잡이를 끌거나 탭해 peek·half·full 로 높이를 바꾸고, peek 아래로 끌면 닫힌다.
              */}
              {isCompact && selected && detailSlot && (
                <BottomSheet
                  snap={sheetSnap}
                  onSnapChange={setSheetSnap}
                  onDismiss={closeDetail}
                >
                  <SpotDetail
                    spot={selected}
                    slot={detailSlot}
                    today={today}
                    onPickSlot={(slot) => setDetailSlotKey(`${slot.date}|${slot.noon}`)}
                    onClose={closeDetail}
                  />
                </BottomSheet>
              )}
            </div>
          )}

          {/*
            * 카드 격자는 화면 폭과 무관하게 열 수를 고정한다.
            * 상세 패널이 열릴 때 목록이 1열↔2열로 흔들리면 방금 누른 카드가 눈앞에서
            * 자리를 옮겨 버린다. 그래서 패널은 격자를 밀어내지 않는 xl 이상에서만 붙이고,
            * 그보다 좁으면 오버레이로 띄운다.
            */}
          <div className={cn('grid gap-2 md:grid-cols-2', view === 'map' && 'hidden')}>
            {loading &&
              Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="h-24 w-full rounded-xl" />
              ))}

            {!loading &&
              ranked.map((row, index) => (
                <SpotCard
                  key={row.spot.id}
                  spot={row.spot}
                  slot={row.slot}
                  rank={index + 1}
                  selected={row.spot.id === selectedId}
                  onSelect={(spot) => {
                    setSelectedId(spot.id);
                    setDetailSlotKey(null);
                  }}
                />
              ))}

            {!loading && !error && ranked.length === 0 && (
              <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-xs">
                조건에 맞는 지점이 없습니다. 어종이나 해역 필터를 풀어 보세요.
              </p>
            )}
          </div>
        </div>

        {/* 데스크톱(≥1280px): 우측 고정 패널. 좁은 화면은 아래에서 시트/모달로 띄운다. */}
        {selected && detailSlot && !isCompact && (
          <aside className="border-border bg-card/90 sticky top-44 block h-[calc(100dvh-12rem)] w-[22rem] shrink-0 self-start overflow-hidden rounded-xl border backdrop-blur">
            <SpotDetail
              spot={selected}
              slot={detailSlot}
              today={today}
              onPickSlot={(slot) => setDetailSlotKey(`${slot.date}|${slot.noon}`)}
              onClose={closeDetail}
            />
          </aside>
        )}
      </div>

      {/*
        목록 보기의 좁은 화면 상세. 여기서는 가릴 지도가 없고 뒤에 있는 건 같은 목록이라
        전체 화면 오버레이가 맞다. 지도 보기는 위 바텀시트가 맡는다.
      */}
      {selected && detailSlot && isCompact && view === 'list' && (
        <div className="fixed inset-0 z-40" role="dialog" aria-label={`${selected.name} 상세`}>
          <button
            type="button"
            aria-label="닫기"
            className="absolute inset-0 bg-black/60"
            onClick={closeDetail}
          />
          <div className="bg-card border-border absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-hidden rounded-t-2xl border-t sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:h-[80dvh] sm:max-h-none sm:w-[26rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border">
            <SpotDetail
              spot={selected}
              slot={detailSlot}
              today={today}
              onPickSlot={(slot) => setDetailSlotKey(`${slot.date}|${slot.noon}`)}
              onClose={closeDetail}
            />
          </div>
        </div>
      )}

      <footer className="text-muted-foreground border-border mt-8 border-t pt-4 text-[11px] leading-relaxed">
        <p className="flex items-start gap-1.5">
          <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            출처: 해양수산부 국립해양조사원 <strong>바다낚시지수</strong> (공공데이터포털 15142486).
            전국 {forecast?.spots.length ?? 49}개 예보지점 · 7일 예보{' '}
            {forecast ? `· 예보 ${forecast.recordCount.toLocaleString()}건` : ''}
            {forecast && ` · 조회 ${new Date(forecast.fetchedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`}
          </span>
        </p>
        <p className="mt-2">
          첫 3일은 오전·오후로 나뉘고 이후 4일은 종일 예보 하나만 제공된다. 해역 구분(동해·서해·남해·제주)은
          원본에 없는 값이라 좌표로 나눈 것이며 필터 용도로만 쓴다. 일부 원해 지점은 최저 수온이 0.1℃ 로
          오는데(결측으로 보인다) 값을 고치지 않고 <span className="text-amber-400">?</span> 표식만 달았다.
        </p>
        <p className="text-destructive-foreground/80 mt-2">
          지수는 참고용이다. 출조 전 반드시 기상특보와 관할 해양경찰의 안전 정보를 확인하라.
        </p>
      </footer>
    </div>
  );
}
