import { Info, TriangleAlert, Waves } from 'lucide-react';

import {
  SWELL_ADVISORY_WAVE_M,
  type RegionSeaState,
  type SeaWarning,
} from '@/lib/sea-state';

/**
 * 해역별 바다상태 요약 스트립.
 *
 * 두 층을 담는다:
 *  - **공식 풍랑특보(A)** — 기상청 기상특보. 발효 중이면 이게 주가 된다.
 *  - **예보값 참고(B)** — 낚시 예보 파고·풍속을 해역 최대로 집계한 값. 특보가 없거나
 *    조회 못 할 때 자리를 채우고, 특보가 있을 땐 보조로 밀린다.
 *
 * 셋을 끝까지 구분한다 — 풍랑경보/주의보(발효), 특보 없음(조회 성공·풍랑 없음),
 * 확인 불가(조회 실패/미구독). **확인 불가를 "특보 없음" 으로 보이면 사람이 위험한 바다에
 * 나간다.** 파고 수치엔 임의의 위험/안전 판정을 붙이지 않는다.
 */

function fmt(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toFixed(digits);
}

type WarnKind = SeaWarning['status'];

/** 특보 상태별 표시(문구·심각도). advisory/warning 은 눈에 띄게, 나머지는 담담하게. */
function warnLabel(kind: WarnKind): string {
  switch (kind) {
    case 'warning':
      return '풍랑경보';
    case 'advisory':
      return '풍랑주의보';
    case 'none':
      return '특보 없음';
    case 'unavailable':
      return '특보 확인 불가';
  }
}

/** 카드 테두리·바탕. 경보는 빨강, 주의보는 주황, 그 외는 기본. */
function cardTone(kind: WarnKind): string {
  if (kind === 'warning') return 'border-red-500/50 bg-red-500/10';
  if (kind === 'advisory') return 'border-amber-500/40 bg-amber-500/10';
  return 'border-border bg-card/60';
}

/** 특보 문구 색. */
function warnTextClass(kind: WarnKind): string {
  if (kind === 'warning') return 'text-red-300 font-semibold';
  if (kind === 'advisory') return 'text-amber-300 font-medium';
  return 'text-muted-foreground';
}

function RegionCard({ state }: { state: RegionSeaState }) {
  const kind = state.warning.status;
  const active = kind === 'warning' || kind === 'advisory';
  const noSample = state.spotCount === 0;
  // 예보 파고가 기상청 풍랑주의보 발효 기준(유의파고 3m)을 넘는지 — 인용 기준이지 우리 판정이 아니다.
  const overAdvisory = state.waveMaxM !== null && state.waveMaxM > SWELL_ADVISORY_WAVE_M;

  return (
    <div className={`flex flex-col gap-1.5 rounded-xl border p-3 ${cardTone(kind)}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{state.region}</span>
        <span className={`flex items-center gap-0.5 text-[10px] ${warnTextClass(kind)}`}>
          {active && <TriangleAlert className="size-3 shrink-0" aria-hidden />}
          {warnLabel(kind)}
        </span>
      </div>

      {noSample ? (
        <p className="text-muted-foreground text-[11px]">예보 표본 없음</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-2 tabular-nums">
            <div className="flex flex-col">
              <span className="text-muted-foreground text-[10px]">예보 최대 파고</span>
              <span className="text-sm font-semibold">
                {fmt(state.waveMaxM)}
                <span className="text-muted-foreground ml-0.5 text-[10px] font-normal">m</span>
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-muted-foreground text-[10px]">예보 최대 풍속</span>
              <span className="text-sm font-semibold">
                {fmt(state.windMaxMs)}
                <span className="text-muted-foreground ml-0.5 text-[10px] font-normal">m/s</span>
              </span>
            </div>
          </div>
          <p className="text-muted-foreground text-[10px] tabular-nums">
            {state.spotCount}곳 집계 · 가장 거친 곳 기준
          </p>
          {overAdvisory && (
            <p className="text-amber-400/90 flex items-start gap-1 text-[10px] leading-snug">
              <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
              <span>기상청 풍랑주의보 기준(유의파고 3m) 초과 · 기상청 기준 인용</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function SeaStateBar({ states }: { states: RegionSeaState[] }) {
  /*
   * 조회 성공 시 warnings 가 4해역을 모두 채우므로(none/advisory/warning), 실패 시에만
   * 전 해역이 unavailable 이 된다. 즉 상태는 셋 중 하나로 깔끔히 갈린다.
   */
  const allUnavailable = states.every((s) => s.warning.status === 'unavailable');
  const active = states.filter(
    (s) => s.warning.status === 'warning' || s.warning.status === 'advisory',
  );
  const hasWarning = active.some((s) => s.warning.status === 'warning');

  return (
    <section className="mb-3" aria-label="해역별 바다상태">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Waves className="text-primary size-3.5 shrink-0" aria-hidden />
        <h2 className="text-xs font-semibold">해역별 바다상태</h2>
        <span className="text-muted-foreground text-[10px]">기상청 특보 + 예보값 참고</span>
      </div>

      {/* 1) 발효 중인 풍랑특보 — 주가 된다. 경보가 하나라도 있으면 빨강, 아니면 주황. */}
      {active.length > 0 && (
        <p
          className={`mb-2 flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${
            hasWarning
              ? 'border-red-500/50 bg-red-500/10 text-red-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
          }`}
        >
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            <strong>발효 중인 풍랑특보</strong> (기상청):{' '}
            {active
              .map((s) => `${s.region} ${s.warning.status === 'warning' ? '경보' : '주의보'}`)
              .join(' · ')}
            . 아래 파고·풍속은 낚시 예보 참고값입니다. 출조 전 기상청·해양경찰 정보를 확인하세요.
          </span>
        </p>
      )}

      {/* 2) 조회 실패/미구독 — 확인 불가. "특보 없음" 으로 보이면 안 된다. */}
      {allUnavailable && (
        <p className="text-muted-foreground border-border bg-card/40 mb-2 flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] leading-snug">
          <Info className="mt-px size-3 shrink-0" aria-hidden />
          <span>
            공식 <strong>풍랑특보</strong>를 지금 확인할 수 없습니다(조회 실패). 아래는 낚시
            예보(국립해양조사원)의 <strong>파고·풍속 참고값</strong>이며 공식 경보가 아닙니다. 출조 전
            기상청 특보와 관할 해양경찰 안전 정보를 반드시 확인하세요.
          </span>
        </p>
      )}

      {/* 3) 조회 성공 + 풍랑 없음 — 담담하게. */}
      {!allUnavailable && active.length === 0 && (
        <p className="text-muted-foreground mb-2 flex items-start gap-1.5 text-[10px] leading-snug">
          <Info className="mt-px size-3 shrink-0" aria-hidden />
          <span>
            현재 발효 중인 <strong>풍랑특보 없음</strong>(기상청). 아래는 낚시 예보의 파고·풍속
            참고값입니다.
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {states.map((state) => (
          <RegionCard key={state.region} state={state} />
        ))}
      </div>
    </section>
  );
}
