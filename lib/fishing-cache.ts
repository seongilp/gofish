import { fetchFishingPage, MAX_ROWS, type RawFishing } from './fishing-api';
import { allFish, buildSpots, dayOptions, type DayOption, type Spot } from './fishing';

/**
 * 예보 전체를 한 번만 받아 두고, 필터는 메모리에서 건다.
 *
 * 왜: 전체가 1,750건(18페이지, 실측 약 4초)뿐이다. 날짜·시간대·어종·해역 필터 조합마다
 * 업스트림을 새로 치면 조합 수만큼 캐시가 갈라져 대부분의 요청이 콜드가 된다.
 * (같은 구조로 만든 유기동물 앱에서 실제로 겪은 문제다 — 콜드가 7초였다.)
 *
 * 통째로 받아 두면 어떤 필터 조합이든 메모리 필터링이라 즉시 응답하고,
 * 업스트림 호출은 조합 수와 무관하게 TTL 당 18콜로 고정된다.
 */

/** 1,750건 / 100행 = 18페이지. 여유를 조금 둔다. */
const MAX_PAGES = 25;

/**
 * 예보는 하루 단위로 갱신된다(발표 주기는 공식 문서에 없다 — 관측되는 값은 일 단위).
 * 3시간이면 새 발표를 놓치지 않으면서 호출도 하루 8×18=144콜로 일 10,000 한도에 여유가 크다.
 *
 * 알림 크론이 발송 직전에 강제 수집하게 바꾼 뒤에도 3시간을 유지한다.
 * 업스트림이 **하루 단위**로만 갱신되므로 TTL 을 줄여도 새 데이터가 나오지 않는다.
 * 즉 줄이면 호출만 늘고 얻는 게 없다. 반대로 늘리면 새 발표를 최대 그만큼 늦게 집는다.
 * 3시간은 일 갱신 주기의 1/8 이라 이미 충분히 촘촘하다.
 */
const TTL_MS = 3 * 60 * 60 * 1000;
const UPSTREAM_REVALIDATE = 3 * 60 * 60;

export interface Forecast {
  spots: Spot[];
  days: DayOption[];
  fish: string[];
  /** 업스트림에서 실제로 받은 레코드 수. 화면에 데이터 규모를 밝히는 데 쓴다. */
  recordCount: number;
  fetchedAt: string;
}

/** 서버 인스턴스 안에서만 사는 캐시. Vercel 함수는 언제든 새로 뜨므로 최선의 추정이다. */
let cached: { at: number; forecast: Forecast } | null = null;

/** 진행 중인 수집. 동시에 여러 요청이 들어와도 업스트림은 한 번만 친다. */
let inflight: Promise<Forecast> | null = null;

async function collect(force = false): Promise<Forecast> {
  const rows: RawFishing[] = [];
  let totalCount = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await fetchFishingPage(page, UPSTREAM_REVALIDATE, force);
    totalCount = result.totalCount;
    rows.push(...result.items);
    if (result.items.length < MAX_ROWS || rows.length >= totalCount) break;
  }

  const spots = buildSpots(rows);
  return {
    spots,
    days: dayOptions(spots),
    fish: allFish(spots),
    recordCount: rows.length,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getForecast(): Promise<Forecast> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.forecast;
  if (inflight) return inflight;

  inflight = collect()
    .then((forecast) => {
      cached = { at: Date.now(), forecast };
      return forecast;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/**
 * 캐시를 전부 무시하고 지금 업스트림에서 다시 받는다. **알림 크론 전용.**
 *
 * 캐시가 두 겹이라 둘 다 뚫어야 한다 —
 *  (1) 이 파일의 `cached`/`TTL_MS` 메모리 캐시: `getForecast` 를 아예 거치지 않는다.
 *  (2) Next 의 Data Cache: `collect(true)` → `fetchFishingPage(..., force)` → `cache: 'no-store'`.
 * 한 겹만 뚫으면 여전히 옛 데이터가 발송된다.
 *
 * `inflight` 는 건드리지 않는다. 강제 수집이 그 자리를 차지하면 동시에 들어온
 * 사용자 요청의 중복 제거가 깨진다. 대신 결과로 `cached` 만 갱신해서,
 * 알림 직후 접속한 사용자도 방금 받은 데이터를 보게 한다(워밍 효과).
 */
export async function getForecastFresh(): Promise<Forecast> {
  const forecast = await collect(true);
  cached = { at: Date.now(), forecast };
  return forecast;
}
