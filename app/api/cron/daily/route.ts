import { NextResponse } from 'next/server';

import { assertCron, siteUrl } from '@/lib/cron-auth';
import { hasWebhook, sendDailyPicks } from '@/lib/discord';
import { getForecast } from '@/lib/fishing-cache';
import { todayKst } from '@/lib/fishing';

/**
 * 매일 오늘의 추천 (07:00 KST).
 *
 * `?day=tomorrow` 로 내일치도 보낼 수 있게 열어 뒀다 — 전날 저녁 알림을 붙이고 싶어지면
 * 크론 한 줄만 추가하면 된다. 기본은 오늘이다.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCron(request);
  if (denied) return denied;

  if (!hasWebhook()) {
    return NextResponse.json({ ok: false, reason: 'DISCORD_WEBHOOK_URL 없음' }, { status: 503 });
  }

  const wantTomorrow = new URL(request.url).searchParams.get('day') === 'tomorrow';
  const forecast = await getForecast();

  // 예보 목록에서 직접 고른다. 날짜를 계산해 만들면 예보에 없는 날을 짚을 수 있다.
  const today = todayKst();
  const dates = forecast.days.map((day) => day.date);
  const target = wantTomorrow
    ? (dates.find((date) => date > today) ?? dates[0])
    : (dates.find((date) => date >= today) ?? dates[0]);

  if (!target) {
    return NextResponse.json({ ok: false, reason: '예보 날짜 없음' }, { status: 502 });
  }

  const result = await sendDailyPicks(
    forecast.spots,
    target,
    target === today ? '오늘' : '내일',
    siteUrl(),
  );

  return NextResponse.json({ ok: true, date: target, ...result });
}
