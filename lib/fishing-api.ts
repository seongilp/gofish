/**
 * 국립해양조사원 바다낚시지수 API 클라이언트. 서버 전용.
 *
 * data.go.kr 15142486 — `GetFcstFishingApiServicev2`.
 *
 * 함정 정리 — 전부 실호출로 확인한 것들이다.
 *
 *  1. serviceKey 는 Encoding 키라 `%2F` 등이 이미 들어 있다. 다시 인코딩하면
 *     SERVICE_KEY_IS_NOT_REGISTERED_ERROR 가 난다. `new URL()` + `searchParams.set()`
 *     도 같은 이유로 깨진다. 그래서 쿼리스트링을 문자열로 직접 조립한다.
 *
 *  2. **응답에 `response` 래퍼가 없다.** 대부분의 data.go.kr API 는
 *     `{ response: { header, body } }` 인데 이 API 는 `{ header, body }` 가 최상위다.
 *     다른 앱의 파서를 그대로 가져오면 조용히 0건이 된다.
 *
 *  3. `gubun`(갯바위/선상)은 **필수**다. 빼면 NO_MANDATORY_REQUEST_PARAMETERS_ERROR(11).
 *     한글값이라 인코딩이 필요하지만 serviceKey 는 건드리면 안 된다.
 *
 *  4. `gubun` 갯바위/선상이 **완전히 같은 1,750건을 준다**(지점 49 공통, 전용 0 — 실측).
 *     서버가 사실상 파라미터를 무시한다. 둘 다 부르면 호출만 2배가 되므로 한쪽만 쓴다.
 *     향후 서버가 실제로 갈라줄 수 있으니 상수로 남겨 둔다.
 *
 *  5. `numOfRows` **상한이 100**이다. 500·1000 을 넣으면 INVALID_REQUEST_PARAMETER_ERROR(10)
 *     가 나는데 **어느 파라미터가 문제인지 알려주지 않는다.** 전수 수집에 18페이지가 필요하다.
 */

const ENDPOINT = 'https://apis.data.go.kr/1192136/fcstFishingv2/GetFcstFishingApiServicev2';

/** 상한 100. 초과하면 코드 10 에러가 나는데 원인을 알려주지 않는다. */
export const MAX_ROWS = 100;

/** 갯바위/선상이 같은 데이터를 주므로 한쪽만 쓴다. (함정 4) */
const GUBUN = '갯바위';

export class FishingApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'FishingApiFailure';
  }
}

function serviceKey(): string {
  const key = process.env.DATA_GO_KR_KEY?.trim();
  if (!key) throw new FishingApiFailure('NO_KEY', 'DATA_GO_KR_KEY 가 설정되지 않았습니다.', 500);
  return key;
}

/** `body.items.item` 한 건. 값이 없는 필드는 `-` 나 undefined 로 온다. */
export interface RawFishing {
  seafsPstnNm: string;
  lat: number;
  lot: number;
  predcYmd: string;
  /** `오전` / `오후` / `일`. 뒤쪽 4일은 오전/오후 구분 없이 `일` 하나뿐이다. */
  predcNoonSeCd: string;
  /** 대상어종. 원해 지점 15곳은 `-` 로 온다. */
  seafsTgfshNm?: string;
  /** 물때. 대조기 / 중조기 / 소조기 */
  tdlvHrCn?: string;
  minWvhgt?: number;
  maxWvhgt?: number;
  minWtem?: number;
  maxWtem?: number;
  minArtmp?: number;
  maxArtmp?: number;
  minCrsp?: number;
  maxCrsp?: number;
  minWspd?: number;
  maxWspd?: number;
  /** 매우좋음 / 좋음 / 보통 / 나쁨 / 매우나쁨 */
  totalIndex?: string;
}

interface FishingResponse {
  header?: { resultCode?: string; resultMsg?: string };
  body?: {
    totalCount?: number;
    pageNo?: number;
    numOfRows?: number;
    items?: { item?: RawFishing[] | RawFishing } | '';
  };
  /** 인증 오류는 이 형태로 온다. */
  OpenAPI_ServiceResponse?: { cmmMsgHeader?: { errMsg?: string; returnAuthMsg?: string } };
}

function buildUrl(page: number, rows: number): string {
  const key = serviceKey();
  // Encoding 키는 그대로, Decoding 키만 한 번 인코딩한다. (함정 1)
  return [
    `${ENDPOINT}?serviceKey=${key.includes('%') ? key : encodeURIComponent(key)}`,
    'type=json',
    `gubun=${encodeURIComponent(GUBUN)}`,
    `pageNo=${page}`,
    `numOfRows=${Math.min(rows, MAX_ROWS)}`,
  ].join('&');
}

/** 한 페이지 조회. `revalidate` 는 Next 의 업스트림 캐시에 그대로 넘긴다. */
export async function fetchFishingPage(
  page: number,
  revalidate: number,
): Promise<{ items: RawFishing[]; totalCount: number }> {
  const response = await fetch(buildUrl(page, MAX_ROWS), {
    next: { revalidate },
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  let parsed: FishingResponse;
  try {
    parsed = JSON.parse(text) as FishingResponse;
  } catch {
    // 인증 오류는 type=json 을 줘도 XML 로 떨어진다.
    const code = /<(?:errMsg|returnAuthMsg)>([^<]*)</.exec(text)?.[1] ?? 'NON_JSON';
    throw new FishingApiFailure(code, `응답을 해석할 수 없습니다: ${text.slice(0, 160)}`);
  }

  const cmm = parsed.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (cmm?.errMsg) throw new FishingApiFailure(cmm.errMsg, cmm.returnAuthMsg ?? cmm.errMsg);

  const header = parsed.header; // 래퍼가 없다. (함정 2)
  if (header?.resultCode && header.resultCode !== '00') {
    throw new FishingApiFailure(header.resultCode, header.resultMsg ?? '조회 실패');
  }

  const body = parsed.body;
  const raw = body?.items;
  // 결과가 없으면 items 가 빈 문자열, 1건이면 배열이 아니라 객체로 온다.
  const container = raw && typeof raw === 'object' ? raw.item : undefined;
  const items = Array.isArray(container) ? container : container ? [container] : [];

  return { items, totalCount: Number(body?.totalCount) || items.length };
}
