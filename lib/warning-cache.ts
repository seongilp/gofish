import { fetchWindWaveWarnings, type WindWaveWarnings } from './warning-api';

/**
 * 풍랑 특보 조회 결과의 짧은 메모리 캐시.
 *
 * TTL 은 **10분**이다. 근거:
 *  - 특보는 파고 예보(3시간 TTL)와 층위가 다르다. 발효·해제가 상황에 따라 시간 단위로
 *    바뀌고, **해제가 늦게 반영되면 사람이 안심하고 위험한 바다에 나갈 수 있다.**
 *    그래서 예보보다 훨씬 짧게 잡는다(예보 TTL 의 1/18).
 *  - 반대로 1~2분으로 더 줄여도 통보문이 그보다 자주 바뀌지 않아 호출만 늘고 얻는 게 없다.
 *    10분이면 발표~반영 지연이 최대 10분이고, 호출도 하루 최대 144콜로 한도에 여유가 크다.
 *
 * **실패는 캐시하지 않는다.** `fetchWindWaveWarnings` 가 던지면 `cached` 를 건드리지 않고
 * 그대로 던진다. 다음 요청이 곧바로 다시 시도하며, 화면은 그 사이 'unavailable'(확인 불가)로
 * 정직하게 남는다. 실패를 캐시하면 특보가 실제로 떴을 때 최대 TTL 만큼 못 잡는다.
 */
const TTL_MS = 10 * 60 * 1000;

let cached: { at: number; warnings: WindWaveWarnings } | null = null;
let inflight: Promise<WindWaveWarnings> | null = null;

export async function getWindWaveWarnings(): Promise<WindWaveWarnings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.warnings;
  if (inflight) return inflight;

  inflight = fetchWindWaveWarnings()
    .then((warnings) => {
      // 성공만 캐시한다.
      cached = { at: Date.now(), warnings };
      return warnings;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
