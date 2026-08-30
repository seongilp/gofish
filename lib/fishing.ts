import type { RawFishing } from './fishing-api';

/**
 * 화면이 쓰는 바다낚시 모델.
 *
 * 원본은 "지점 × 날짜 × 시간대 × 어종" 이 전부 평평하게 펼쳐진 1,750건이다.
 * 그대로는 아무것도 못 한다 — 같은 지점·같은 시간대의 파고·수온·물때는 전부 동일하고
 * **어종별로 다른 건 `totalIndex` 하나뿐**이기 때문이다(실측 확인).
 * 그래서 "지점 → 슬롯(날짜+시간대) → 어종별 지수" 로 접어서 쓴다.
 */

/** 지수 5단계. 정렬·색상에 쓰려면 순서가 있는 점수가 필요하다. */
export const INDEX_SCORE: Record<string, number> = {
  매우좋음: 5,
  좋음: 4,
  보통: 3,
  나쁨: 2,
  매우나쁨: 1,
};

export const INDEX_LABELS = ['매우좋음', '좋음', '보통', '나쁨', '매우나쁨'] as const;

export type Region = '동해' | '서해' | '남해' | '제주';
export const REGIONS: Region[] = ['동해', '서해', '남해', '제주'];

/** `오전` / `오후` / `일`. `일` 은 오전·오후 구분 없는 종일 예보다. */
export type NoonCode = '오전' | '오후' | '일';

export interface Range {
  min: number | null;
  max: number | null;
}

export interface FishIndex {
  name: string;
  index: string;
  score: number;
}

/** 한 지점의 한 시간대(날짜 + 오전/오후/종일). */
export interface Slot {
  date: string;
  noon: NoonCode;
  /** 대조기 / 중조기 / 소조기 */
  tide: string;
  wave: Range;
  waterTemp: Range;
  airTemp: Range;
  current: Range;
  wind: Range;
  /** 어종별 지수. 지수 좋은 순. 원해 지점은 빈 배열이다. */
  fish: FishIndex[];
  /** 이 슬롯의 대표 지수 = 어종 중 가장 좋은 값. 랭킹의 기준이다. */
  bestScore: number;
  bestIndex: string;
}

export interface Spot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  region: Region;
  /**
   * 어종 정보가 없는 지점(응답의 `seafsTgfshNm` 이 `-`).
   * 실측 49곳 중 15곳이 여기 해당하고, 전부 `인천항 서측(24km)` 처럼 연안에서 떨어진
   * 원해 예보 지점이다. 지수는 정상으로 오되 대상어종만 비어 있다.
   */
  offshore: boolean;
  slots: Slot[];
}

/* ------------------------------------------------------------------ */

/**
 * 좌표로 해역을 나눈다.
 *
 * 왜 좌표로 하나: API 가 해역 구분을 주지 않는다. 지점명에도 없다.
 * 49곳뿐이라 손으로 표를 만들 수도 있지만, 지점이 추가되면 조용히 누락된다.
 * 경계값은 실제 49지점을 눈으로 확인해 맞췄다. 지어낸 값이 아니라 분류 규칙이므로
 * 화면에는 "지수 데이터"가 아닌 "필터"로만 쓴다.
 *
 * 추자도(33.96N)는 위도만 보면 제주 밖이지만 행정구역상 제주시 추자면이라
 * 별도 구간으로 제주에 넣는다.
 */
export function regionOf(lat: number, lon: number): Region {
  if (lat < 33.65) return '제주';
  if (lat < 34.05 && lon >= 126.1 && lon < 127.0) return '제주'; // 추자도
  if (lon < 126.7) return '서해';
  if (lat >= 35.4 && lon >= 128.4) return '동해';
  return '남해';
}

function num(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function range(min: number | undefined, max: number | undefined): Range {
  return { min: num(min), max: num(max) };
}

function noonOf(value: string): NoonCode {
  return value === '오전' || value === '오후' ? value : '일';
}

/**
 * 평평한 1,750건을 지점 49개로 접는다.
 *
 * 슬롯 키는 `날짜|시간대`. 같은 슬롯의 파고·수온·물때는 어느 레코드에서 읽어도 같으므로
 * 처음 만난 레코드 값을 쓰고, 어종만 계속 쌓는다.
 */
export function buildSpots(rows: RawFishing[]): Spot[] {
  const spots = new Map<string, Spot>();
  const slotsBySpot = new Map<string, Map<string, Slot>>();

  for (const row of rows) {
    const name = row.seafsPstnNm?.trim();
    if (!name || !Number.isFinite(row.lat) || !Number.isFinite(row.lot)) continue;

    let spot = spots.get(name);
    if (!spot) {
      spot = {
        id: name,
        name,
        lat: row.lat,
        lon: row.lot,
        region: regionOf(row.lat, row.lot),
        offshore: true, // 어종이 하나라도 나오면 아래에서 false 로 내린다.
        slots: [],
      };
      spots.set(name, spot);
      slotsBySpot.set(name, new Map());
    }

    const slots = slotsBySpot.get(name)!;
    const key = `${row.predcYmd}|${row.predcNoonSeCd}`;
    let slot = slots.get(key);
    if (!slot) {
      slot = {
        date: row.predcYmd,
        noon: noonOf(row.predcNoonSeCd),
        tide: row.tdlvHrCn?.trim() || '',
        wave: range(row.minWvhgt, row.maxWvhgt),
        waterTemp: range(row.minWtem, row.maxWtem),
        airTemp: range(row.minArtmp, row.maxArtmp),
        current: range(row.minCrsp, row.maxCrsp),
        wind: range(row.minWspd, row.maxWspd),
        fish: [],
        bestScore: 0,
        bestIndex: '',
      };
      slots.set(key, slot);
    }

    const index = row.totalIndex?.trim() ?? '';
    const score = INDEX_SCORE[index] ?? 0;
    const fishName = row.seafsTgfshNm?.trim();

    // 어종이 `-` 인 원해 지점은 어종 목록에 넣지 않는다. 지수는 살아 있다.
    if (fishName && fishName !== '-') {
      spot.offshore = false;
      slot.fish.push({ name: fishName, index, score });
    }
    if (score > slot.bestScore) {
      slot.bestScore = score;
      slot.bestIndex = index;
    }
  }

  for (const [name, slots] of slotsBySpot) {
    const spot = spots.get(name)!;
    spot.slots = [...slots.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || noonOrder(a.noon) - noonOrder(b.noon),
    );
    for (const slot of spot.slots) {
      slot.fish.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ko'));
    }
  }

  return [...spots.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

function noonOrder(noon: NoonCode): number {
  return noon === '오전' ? 0 : noon === '오후' ? 1 : 2;
}

/* ------------------------------------------------------------------ */

export interface DayOption {
  date: string;
  /** 그 날짜에 실제로 존재하는 시간대. 뒤쪽 4일은 `['일']` 뿐이다. */
  noons: NoonCode[];
}

/**
 * 예보에 존재하는 날짜와 시간대를 데이터에서 뽑는다.
 *
 * **첫 3일만 오전/오후로 갈리고 나머지 4일은 종일(`일`) 하나뿐이다**(실측).
 * 그래서 오전/오후 토글을 7일 내내 켜 두면 뒤쪽 4일이 통째로 빈 화면이 된다.
 * 날짜별로 있는 시간대를 데이터에서 읽어 UI 가 그대로 따르게 한다.
 */
export function dayOptions(spots: Spot[]): DayOption[] {
  const byDate = new Map<string, Set<NoonCode>>();
  for (const spot of spots) {
    for (const slot of spot.slots) {
      const set = byDate.get(slot.date) ?? new Set<NoonCode>();
      set.add(slot.noon);
      byDate.set(slot.date, set);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, noons]) => ({
      date,
      noons: [...noons].sort((a, b) => noonOrder(a) - noonOrder(b)),
    }));
}

/** 예보에 등장하는 어종 전체. 필터 옵션용. */
export function allFish(spots: Spot[]): string[] {
  const set = new Set<string>();
  for (const spot of spots) {
    for (const slot of spot.slots) for (const fish of slot.fish) set.add(fish.name);
  }
  // `기타어종` 은 목록 끝으로 민다.
  return [...set].sort((a, b) =>
    a === '기타어종' ? 1 : b === '기타어종' ? -1 : a.localeCompare(b, 'ko'),
  );
}

/* ------------------------------------------------------------------ */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** `2026-08-30` → `8.30 (일)`. API 가 이미 하이픈 형식으로 준다. */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}.${d} (${weekday})`;
}

/** `2026-09-02` → `9.2`. 히트맵처럼 열이 좁은 곳에서 쓴다. */
export function formatDateShort(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return m && d ? `${m}.${d}` : date;
}

/** 오늘 기준 상대 라벨. 오늘/내일만 붙이고 나머지는 null. */
export function relativeDay(date: string, today: string): string | null {
  if (date === today) return '오늘';
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return diff === 1 ? '내일' : null;
}

/** KST 기준 오늘 날짜. 서버가 UTC 라도 사용자 기준과 어긋나면 안 된다. */
export function todayKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** `0.9 ~ 1.3` 형태. 값이 같으면 하나만, 없으면 `—`. */
export function formatRange(range: Range, digits = 1): string {
  const { min, max } = range;
  if (min === null && max === null) return '—';
  if (min === null || max === null) return (min ?? max)!.toFixed(digits);
  if (Math.abs(min - max) < 10 ** -digits / 2) return min.toFixed(digits);
  return `${min.toFixed(digits)}~${max.toFixed(digits)}`;
}

/**
 * 수온 최저값이 결측 자리표시자로 보이는가.
 *
 * 원해 지점 4곳(거진항동측·공현진항 동남동·도두항 북서·척포항 남남서)에서
 * `minWtem` 이 정확히 `0.1` 로 오고 최고값은 25℃ 안팎이다(1,750건 중 16건, 실측).
 * 한여름 연안 수온 0.1℃ 는 물리적으로 불가능하니 결측을 0.1 로 채운 값으로 보인다.
 *
 * **값을 고치지는 않는다.** 원본을 임의로 덮어쓰면 어디까지가 관측인지 알 수 없게 된다.
 * 대신 화면에 표식을 달아 사용자가 판단하게 한다.
 */
export function looksLikeMissingLow(range: Range): boolean {
  return range.min === 0.1 && range.max !== null && range.max > 15;
}

/**
 * 지수 5단계의 색. **단일 출처다.**
 *
 * 목록 배지, 분포 막대, 히트맵, 지도 원이 전부 여기서 색을 가져온다.
 * 지도만 따로 hex 상수를 두면 어느 한쪽을 고쳤을 때 범례가 조용히 거짓말을 한다.
 * 그래서 면(solid)으로 칠하는 곳은 전부 `hex` 를 inline style 로 쓰고,
 * Tailwind 클래스는 반투명 배경 + 글자색인 배지에만 쓴다.
 *
 * hex 는 Tailwind 400 단계 값이다 (sky/emerald/amber/orange/red).
 */
export function indexTone(index: string): { bg: string; text: string; hex: string } {
  switch (index) {
    case '매우좋음':
      return { bg: 'bg-sky-500/15', text: 'text-sky-300', hex: '#38bdf8' };
    case '좋음':
      return { bg: 'bg-emerald-500/15', text: 'text-emerald-300', hex: '#34d399' };
    case '보통':
      return { bg: 'bg-amber-500/15', text: 'text-amber-300', hex: '#fbbf24' };
    case '나쁨':
      return { bg: 'bg-orange-500/15', text: 'text-orange-300', hex: '#fb923c' };
    case '매우나쁨':
      return { bg: 'bg-red-500/15', text: 'text-red-300', hex: '#f87171' };
    default:
      return { bg: 'bg-muted', text: 'text-muted-foreground', hex: '#6b7280' };
  }
}
