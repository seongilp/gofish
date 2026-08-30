import { NextResponse } from 'next/server';

import { assertCron } from '@/lib/cron-auth';
import { getForecast } from '@/lib/fishing-cache';

/**
 * 새벽 데이터 데우기. Discord 발송은 없다.
 *
 * 캐시는 서버 인스턴스 메모리에 있고 Vercel 함수는 언제든 새로 뜨므로 이 라우트가
 * "미리 데워둠"을 완전히 보장하지는 못한다. 다만 업스트림 fetch 에 걸린 3시간
 * revalidate 가 Vercel Data Cache 에 남으므로, 새벽에 한 번 돌려두면 아침 첫 사용자와
 * 뒤이어 도는 알림 크론이 18페이지 콜드(실측 6초)를 덜 맞는다.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCron(request);
  if (denied) return denied;

  const started = Date.now();
  const forecast = await getForecast();

  return NextResponse.json({
    ok: true,
    spots: forecast.spots.length,
    records: forecast.recordCount,
    elapsedMs: Date.now() - started,
  });
}
