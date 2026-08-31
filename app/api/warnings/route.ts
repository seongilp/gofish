import { NextResponse } from 'next/server';

import { getWindWaveWarnings } from '@/lib/warning-cache';
import { WarningApiFailure } from '@/lib/warning-api';

/**
 * 현재 발효 중인 **풍랑 특보**를 해역별로 준다. 예보(`/api/forecast`)와 분리한 이유는
 * 신선도 요구가 다르기 때문이다 — 예보는 하루 단위(CDN 3시간)지만 특보는 수시로 바뀌어
 * 훨씬 짧게 잡아야 한다. 한 응답에 묶으면 둘 중 하나의 캐시가 반드시 틀어진다.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function GET(): Promise<NextResponse> {
  try {
    const { byRegion, announcedAt } = await getWindWaveWarnings();
    return NextResponse.json(
      { warnings: byRegion, announcedAt },
      {
        // 특보는 수시로 바뀐다. CDN 도 짧게 — 엣지 신선도 5분, 그동안은 SWR 로 버틴다.
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
      },
    );
  } catch (error) {
    /*
     * 조회 실패는 502 로 정직하게 내린다. **캐시하지 않는다**(비-2xx 는 CDN 이 캐시 안 함).
     * 클라이언트는 이 응답을 받으면 warnings 를 주입하지 않아 전 해역이 'unavailable'
     * (확인 불가)로 남는다. 절대 '특보 없음' 으로 보이지 않는다.
     */
    const failure = error instanceof WarningApiFailure ? error : null;
    return NextResponse.json(
      { error: failure?.code ?? 'WARNING_FETCH_FAILED', message: failure?.message ?? '조회 실패' },
      { status: failure?.status ?? 502 },
    );
  }
}
