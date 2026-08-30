import { NextResponse } from 'next/server';

import { assertCron, cronTrigger, describeTrigger, siteUrl } from '@/lib/cron-auth';
import { hasWebhook, sendDailyPicks } from '@/lib/discord';
import { getForecastFresh } from '@/lib/fishing-cache';
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

  const trigger = cronTrigger(request);
  const wantTomorrow = new URL(request.url).searchParams.get('day') === 'tomorrow';
  // 발송 직전 강제 수집. 캐시된 예보로 알림을 보내면 하루 지난 지수가 나갈 수 있다.
  const forecast = await getForecastFresh();

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
    describeTrigger(trigger),
  );

  // fetchedAt 을 응답에 실어 둔다. 강제 수집이 실제로 돌았는지 밖에서 확인할 방법이 이것뿐이다.
  return NextResponse.json({
    ok: true,
    date: target,
    fetchedAt: forecast.fetchedAt,
    // 자동 발화 여부를 응답에도 실어 둔다. 수동으로 확인할 때 "지금 이건 수동이다" 를
    // 응답만 보고 알 수 있게 하려는 목적이다.
    trigger,
    ...result,
  });
}
