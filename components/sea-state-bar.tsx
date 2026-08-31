import { Info, TriangleAlert, Waves } from 'lucide-react';

import {
  SWELL_ADVISORY_WAVE_M,
  type RegionSeaState,
  type SeaWarning,
} from '@/lib/sea-state';

/**
 * 해역별 바다상태 요약 스트립 (B 층).
 *
 * **공식 풍랑특보가 아니다.** 낚시 예보의 파고·풍속을 해역 단위로 최대 집계한
 * 참고값이다. 그 사실을 스트립 머리에서 먼저 밝히고, 각 해역의 수치를 담담하게 보여준다.
 * 수치에 위험/안전 판정을 임의로 붙이지 않는다 — 판단은 사용자 몫이다.
 */

function fmt(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toFixed(digits);
}

/**
 * 공식 특보 상태 한 줄.
 *
 * 현재는 항상 `unavailable` — 기상특보 API 미구독이라 조회 자체를 못 한다.
 * **조회 불가를 "특보 없음" 으로 보이면 안 된다.** 그래서 "확인할 수 없습니다" 라고
 * 정직하게 쓴다. A(공식 특보)가 열리면 none/advisory/warning 분기를 여기에 채운다.
 */
function warningLine(warning: SeaWarning): { text: string; tone: 'muted' | 'alert' } {
  switch (warning.status) {
    case 'unavailable':
      return { text: '공식 특보 확인 불가', tone: 'muted' };
    case 'none':
      return { text: '현재 특보 없음', tone: 'muted' };
    case 'advisory':
      return { text: '풍랑주의보', tone: 'alert' };
    case 'warning':
      return { text: '풍랑경보', tone: 'alert' };
  }
}

function RegionCard({ state }: { state: RegionSeaState }) {
  const warn = warningLine(state.warning);
  const noSample = state.spotCount === 0;
  // 예보 파고가 기상청 풍랑주의보 발효 기준(유의파고 3m)을 넘는지 — 인용 기준이지 우리 판정이 아니다.
  const overAdvisory = state.waveMaxM !== null && state.waveMaxM > SWELL_ADVISORY_WAVE_M;

  return (
    <div className="border-border bg-card/60 flex flex-col gap-1.5 rounded-xl border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{state.region}</span>
        <span
          className={
            warn.tone === 'alert'
              ? 'text-destructive-foreground text-[10px] font-medium'
              : 'text-muted-foreground text-[10px]'
          }
        >
          {warn.text}
        </span>
      </div>

      {noSample ? (
        <p className="text-muted-foreground text-[11px]">표본 없음</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-2 tabular-nums">
            <div className="flex flex-col">
              <span className="text-muted-foreground text-[10px]">최대 파고</span>
              <span className="text-sm font-semibold">
                {fmt(state.waveMaxM)}
                <span className="text-muted-foreground ml-0.5 text-[10px] font-normal">m</span>
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-muted-foreground text-[10px]">최대 풍속</span>
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
  // 조회가 불가한 현재, 스트립 전체가 "예보값 참고" 임을 머리에서 못박는다.
  const allUnavailable = states.every((s) => s.warning.status === 'unavailable');

  return (
    <section className="mb-3" aria-label="해역별 바다상태">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Waves className="text-primary size-3.5 shrink-0" aria-hidden />
        <h2 className="text-xs font-semibold">해역별 바다상태</h2>
        <span className="text-muted-foreground text-[10px]">예보값 참고</span>
      </div>

      {allUnavailable && (
        <p className="text-muted-foreground border-border bg-card/40 mb-2 flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] leading-snug">
          <Info className="mt-px size-3 shrink-0" aria-hidden />
          <span>
            공식 <strong>풍랑특보</strong>는 현재 제공하지 못합니다. 아래는 낚시 예보(국립해양조사원)의
            해역 내 지점 <strong>파고·풍속을 집계한 참고값</strong>이며 공식 경보가 아닙니다. 출조 전
            기상청 특보와 관할 해양경찰 안전 정보를 반드시 확인하세요.
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
