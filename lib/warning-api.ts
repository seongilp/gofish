import { REGIONS, type Region } from './fishing';
import type { SeaWarning } from './sea-state';

/**
 * 기상청 기상특보에서 **풍랑 특보**만 뽑아 해역별로 접는 클라이언트. 서버 전용.
 *
 * data.go.kr 1360000 — `WthrWrnInfoService/getWthrWrnMsg`(기상특보 통보문).
 *
 * 왜 통보문(t6)인가 — 실호출로 정한 것들이다.
 *
 *  1. **`t6` 가 "현재 발효 중인 특보" 공식 스냅샷이다.** stnId=108(전국) 통보문의 t6 에
 *     전국 발효 현황이 "o {특보종류} : {구역들}" 줄로 다 온다. 최신 통보문이 "○○ 해제"
 *     한 건이어도 t6 는 그 시점의 전체 현황을 담는다(실측 확인).
 *
 *  2. 구조화된 `getPwnCd` 도 있지만 한 통보문의 발표/해제/유지(command)가 섞여 있어
 *     "지금 활성"을 잘못 읽을 위험이 있다. t6 는 **해제된 특보가 애초에 안 들어오므로**
 *     안전하다. 낚시는 사람이 물에 들어가는 활동이라 이 구분이 안전 문제다.
 *
 *  3. 풍랑 구역은 해상예보구역(서해중부먼바다·남해서부먼바다·동해중부먼바다·제주도남쪽먼바다
 *     등)이라 전부 서해/남해/동해/제주 키워드를 포함한다 → 4해역에 키워드로 매핑된다.
 *     육상 특보(호우·폭염) 줄은 파싱 대상이 아니라 키워드 오염이 없다.
 *
 *  4. `tmFc`(발표시각)는 KST 다(예: 202608311800 = 2026-08-31 18:00 KST, 실측).
 *
 * **왜 풍랑만 거르나**: 사용자가 말한 "풍랑" 의 정확한 대응이고, 풍랑 구역만 해상예보구역이라
 * 4해역 매핑이 명확하다. 태풍·폭풍해일은 구역이 시군이라 해역 매핑이 모호해 "엉뚱한 해역에
 * 특보를 붙이는" 위험이 있고, 바다가 거칠 땐 풍랑 특보가 함께 발효되므로 풍랑으로 신호를
 * 잡는다. 확장이 필요하면 이 파일에서 대상 특보를 늘리면 된다.
 */

const ENDPOINT = 'http://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnMsg';
/** 전국 종합 통보문. t6 에 전국 발효 현황이 다 온다. */
const STN_NATIONWIDE = '108';

export class WarningApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'WarningApiFailure';
  }
}

function serviceKey(): string {
  const key = process.env.KMA_SERVICE_KEY?.trim();
  if (!key) throw new WarningApiFailure('NO_KEY', 'KMA_SERVICE_KEY 가 설정되지 않았습니다.', 500);
  return key;
}

/** 심각도 순위. 같은 해역이 여러 줄에 걸리면 높은 쪽을 남긴다. */
const SEVERITY: Record<SeaWarning['status'], number> = {
  unavailable: -1,
  none: 0,
  advisory: 1,
  warning: 2,
};

/**
 * 통보문 t6 자유텍스트에서 **풍랑 특보만** 뽑아 해역별 수준으로 접는다.
 *
 * 한 줄이 "o 풍랑주의보 : 서해중부먼바다, 남해서부먼바다, ..." 형태다. `풍랑경보` 가 있으면
 * 경보, 아니면 `풍랑주의보` 는 주의보. 콜론 뒤 구역 문자열에서 4해역 키워드를 훑어
 * 걸리는 해역에 그 수준을 표시한다. 풍랑이 아닌 줄(호우·폭염 등)은 건너뛰므로
 * 육상 구역명에 섞인 '제주도' 같은 토큰이 오탐되지 않는다.
 *
 * 순수 함수다. 반환에 없는 해역 = 풍랑 특보 없음(호출부가 'none' 으로 처리).
 */
export function parseWindWaveWarnings(t6: string): Partial<Record<Region, SeaWarning>> {
  const out: Partial<Record<Region, SeaWarning>> = {};

  for (const rawLine of t6.split(/\r?\n/)) {
    const line = rawLine.trim();
    const isWarning = line.includes('풍랑경보');
    const isAdvisory = line.includes('풍랑주의보');
    if (!isWarning && !isAdvisory) continue;

    const colon = line.indexOf(':');
    const regionText = colon >= 0 ? line.slice(colon + 1) : line;
    const status: SeaWarning['status'] = isWarning ? 'warning' : 'advisory';

    for (const region of REGIONS) {
      if (!regionText.includes(region)) continue;
      const current = out[region]?.status ?? 'none';
      if (SEVERITY[status] > SEVERITY[current]) out[region] = { status };
    }
  }

  return out;
}

interface WrnMsgResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { items?: { item?: Array<{ t6?: string; tmFc?: number }> | { t6?: string; tmFc?: number } } | '' };
  };
  OpenAPI_ServiceResponse?: { cmmMsgHeader?: { errMsg?: string; returnAuthMsg?: string } };
}

export interface WindWaveWarnings {
  /** 해역별 풍랑 특보 상태. 조회 성공 시 4해역이 모두 채워진다(특보 없으면 'none'). */
  byRegion: Partial<Record<Region, SeaWarning>>;
  /** 통보문 발표시각(KST) `YYYYMMDDHHmm`. 화면에 신선도를 밝히는 데 쓴다. */
  announcedAt: number | null;
}

/**
 * 현재 발효 중인 풍랑 특보를 해역별로 조회한다.
 *
 * **조회 성공** → 4해역을 모두 'none' 으로 깔고 풍랑이 걸린 해역만 advisory/warning 으로
 * 덮는다. 즉 "특보 없음"(none)이 해역마다 명시된다.
 * **조회 실패**(HTTP/JSON/인증/resultCode 오류, 타임아웃) → 던진다. 호출부는 이걸
 * 캐시하지 않고, 화면은 warnings 를 주입하지 않아 전 해역이 'unavailable'(확인 불가)로 남는다.
 * **조회 실패를 절대 'none' 으로 떨어뜨리지 않는다** — 그러면 사람이 위험한 바다에 나간다.
 */
export async function fetchWindWaveWarnings(): Promise<WindWaveWarnings> {
  const key = serviceKey();
  // Encoding 키(% 포함)는 그대로, Decoding 키만 한 번 인코딩한다.
  const url =
    `${ENDPOINT}?serviceKey=${key.includes('%') ? key : encodeURIComponent(key)}` +
    `&pageNo=1&numOfRows=1&dataType=JSON&stnId=${STN_NATIONWIDE}`;

  const response = await fetch(url, {
    // 특보는 수시로 바뀌므로 업스트림 재검증을 짧게 잡는다.
    next: { revalidate: 600 },
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  const text = await response.text();
  let parsed: WrnMsgResponse;
  try {
    parsed = JSON.parse(text) as WrnMsgResponse;
  } catch {
    const code = /<(?:errMsg|returnAuthMsg)>([^<]*)</.exec(text)?.[1] ?? 'NON_JSON';
    throw new WarningApiFailure(code, `응답을 해석할 수 없습니다: ${text.slice(0, 160)}`);
  }

  const cmm = parsed.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (cmm?.errMsg) throw new WarningApiFailure(cmm.errMsg, cmm.returnAuthMsg ?? cmm.errMsg);

  const header = parsed.response?.header;
  if (header?.resultCode && header.resultCode !== '00') {
    throw new WarningApiFailure(header.resultCode, header.resultMsg ?? '조회 실패');
  }

  const raw = parsed.response?.body?.items;
  const container = raw && typeof raw === 'object' ? raw.item : undefined;
  const item = Array.isArray(container) ? container[0] : container;
  const t6 = item?.t6 ?? '';
  const announcedAt = typeof item?.tmFc === 'number' ? item.tmFc : null;

  // 성공: 전 해역 none 으로 깔고 풍랑만 덮는다.
  const byRegion: Partial<Record<Region, SeaWarning>> = {};
  for (const region of REGIONS) byRegion[region] = { status: 'none' };
  Object.assign(byRegion, parseWindWaveWarnings(t6));

  return { byRegion, announcedAt };
}
