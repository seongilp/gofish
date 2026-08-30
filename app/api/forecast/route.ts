import { NextResponse } from 'next/server';

import { FishingApiFailure } from '@/lib/fishing-api';
import { getForecast } from '@/lib/fishing-cache';

/**
 * `dynamic = 'force-dynamic'` 이 없으면 route handler 가 정적 프리렌더된다.
 * 그러면 빌드 타임에 외부 API 를 때리고, 사용자의 새로고침도 빌드 시점 데이터에 막힌다.
 * 신선도는 업스트림 `fetch(..., { next: { revalidate } })` 와 아래 Cache-Control 로 잡는다.
 */
export const dynamic = 'force-dynamic';
/** 콜드 수집이 18콜(실측 약 4초)이라 기본 타임아웃으로는 아슬아슬하다. */
export const maxDuration = 60;

/**
 * 예보 전체를 한 번에 준다.
 *
 * 왜 필터를 서버에서 걸지 않나: 49지점 × 10슬롯이라 전체를 줘도 gzip 후 수십 KB다.
 * 날짜·시간대·어종을 바꿀 때마다 왕복하면 체감이 확 나빠지는데, 얻는 게 없다.
 * 한 번 받아 두면 이후 조작은 전부 클라이언트 메모리에서 끝난다.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const forecast = await getForecast();
    return NextResponse.json(forecast, {
      // 예보는 하루 단위로 바뀐다. CDN 이 함수 실행 자체를 막게 한다.
      headers: { 'Cache-Control': 'public, s-maxage=10800, stale-while-revalidate=43200' },
    });
  } catch (error) {
    if (error instanceof FishingApiFailure) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    throw error;
  }
}
