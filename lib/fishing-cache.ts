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

async function collect(): Promise<Forecast> {
  const rows: RawFishing[] = [];
  let totalCount = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await fetchFishingPage(page, UPSTREAM_REVALIDATE);
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
