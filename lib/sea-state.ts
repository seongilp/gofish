import { REGIONS, type NoonCode, type Region, type Spot } from './fishing';

/**
 * 해역별 바다상태 요약 (B 층, 폴백).
 *
 * **이건 공식 풍랑특보가 아니다.** 낚시 예보 API(국립해양조사원)가 지점별로 주는
 * 파고·풍속을, 앱이 이미 받아 둔 데이터에서 해역 단위로 집계한 "예보값 참고" 다.
 * 새 API 를 부르지 않는다.
 *
 * 왜 이 층이 따로 있나: 사용자가 원한 건 서해·동해·남해의 바다 거칠기다. 그 정답은
 * 기상청 풍랑주의보/경보(공식 특보)인데, 현재 인증키가 기상특보 서비스에 미구독이라
 * 조회 자체를 못 한다(실측 확인). 그래서 조회가 가능해질 때까지 이 예보값 집계가
 * 자리를 채운다. 공식 특보(A)가 열리면 아래 `warning` 자리에 얹는다.
 */

/**
 * 공식 특보(A)가 들어올 자리.
 *
 * 지금은 기상특보 API 미구독이라 조회를 못 하므로 항상 `'unavailable'` 이다.
 * A 를 붙일 때 서버에서 특보를 조회해 해역별로 이 값을 채우고(`'none'` / `'advisory'` /
 * `'warning'`), UI 의 특보 렌더 분기만 확장하면 B 집계는 그대로 둘 수 있다.
 *
 * **절대 규칙**: `'unavailable'`(조회 실패/미구독)을 `'none'`(특보 없음)으로 뭉개면 안 된다.
 * 조회를 못 한 것과 특보가 없는 것은 완전히 다르다 — 전자를 후자로 보이면 사람이
 * 위험한 바다에 나간다.
 */
export type SeaWarning =
  | { status: 'unavailable' } // 기상특보 API 로 조회 불가 (현재 상태)
  | { status: 'none' } // 조회 성공, 발효 중인 풍랑특보 없음 (A)
  | { status: 'advisory' } // 풍랑주의보 (A)
  | { status: 'warning' }; // 풍랑경보 (A)

export interface RegionSeaState {
  region: Region;
  /**
   * 해역 내 지점들의 **최대** 예보 파고(m). 가장 거친 곳 기준.
   * null 이면 그 해역에 해당 시간대 표본이 없다는 뜻이다(결측과 구분).
   */
  waveMaxM: number | null;
  /** 해역 내 지점들의 최대 예보 풍속(m/s). */
  windMaxMs: number | null;
  /** 집계에 쓴 지점 수. 표본이 적으면 화면에서 밝혀 과대해석을 막는다. */
  spotCount: number;
  /** 공식 특보 자리. 현재는 항상 unavailable. */
  warning: SeaWarning;
}

/**
 * 기상청 풍랑주의보 발효 기준(유의파고 3m 초과).
 *
 * **이건 우리 판정 기준이 아니라 기상청 공식 기준의 인용값이다.** 파고 수치에
 * 위험도를 임의로 붙일 권한은 우리에게 없다. 다만 예보 파고가 이 공식 기준을
 * 넘는지 여부는 출처를 밝혀 참고로 보여줄 수 있다.
 * 출처: 기상청 기상특보 발표 기준(풍랑주의보: 해상 풍속 14m/s 이상 3시간 지속 또는
 * 유의파고 3m 초과).
 */
export const SWELL_ADVISORY_WAVE_M = 3;
export const SWELL_ADVISORY_WIND_MS = 14;

/** Range 에서 "가장 거친" 대표값. 최댓값을 우선하고 없으면 최솟값을 쓴다. */
function roughest(range: { min: number | null; max: number | null }): number | null {
  if (range.max !== null) return range.max;
  if (range.min !== null) return range.min;
  return null;
}

function maxOrNull(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * 고른 날짜·시간대의 해역별 파고·풍속을 집계한다.
 *
 * 집계는 **최댓값**이다(평균이 아니다). 한 해역에서 한 곳이라도 거칠면 그 바다는
 * 거친 것이고, 평균은 그 신호를 지운다. 낚시는 사람이 물에 들어가는 활동이라
 * 안전 관점에선 "그 해역에서 가장 거친 곳" 이 맞는 대표값이다.
 *
 * `warnings` 는 공식 특보(A)가 열렸을 때 해역별 특보를 주입하는 자리다. 지금은
 * 호출부가 넘기지 않으므로 모든 해역이 `'unavailable'` 이 된다.
 */
export function regionSeaStates(
  spots: Spot[],
  date: string | undefined,
  noon: NoonCode,
  warnings?: Partial<Record<Region, SeaWarning>>,
): RegionSeaState[] {
  const acc = new Map<Region, { wave: number | null; wind: number | null; count: number }>();
  for (const region of REGIONS) acc.set(region, { wave: null, wind: null, count: 0 });

  if (date) {
    for (const spot of spots) {
      const slot = spot.slots.find((s) => s.date === date && s.noon === noon);
      if (!slot) continue;
      const wave = roughest(slot.wave);
      const wind = roughest(slot.wind);
      if (wave === null && wind === null) continue;

      const bucket = acc.get(spot.region)!;
      bucket.wave = maxOrNull(bucket.wave, wave);
      bucket.wind = maxOrNull(bucket.wind, wind);
      bucket.count += 1;
    }
  }

  return REGIONS.map((region) => {
    const bucket = acc.get(region)!;
    return {
      region,
      waveMaxM: bucket.wave,
      windMaxMs: bucket.wind,
      spotCount: bucket.count,
      warning: warnings?.[region] ?? { status: 'unavailable' },
    };
  });
}
