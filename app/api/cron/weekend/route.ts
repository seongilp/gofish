import { NextResponse } from 'next/server';

import { assertCron, siteUrl } from '@/lib/cron-auth';
import { hasWebhook, sendWeekendOutlook } from '@/lib/discord';
import { getForecast } from '@/lib/fishing-cache';
import { todayKst } from '@/lib/fishing';

/**
 * 주말 전망 (금요일 18:00 KST).
 *
 * 금요일 기준으로 토=D+1, 일=D+2 라 둘 다 오전/오후가 있는 앞 3일 구간에 들어온다.
 * (뒤쪽 4일은 종일 예보 하나뿐이라 시간대 정보가 없다.)
 *
 * 요일은 예보 날짜에서 직접 읽는다. 크론이 밀리거나 수동으로 호출해도
 * "다음에 오는 주말" 을 집도록 해서 엉뚱한 날을 보내지 않는다.
 *
 * **토·일을 각각 따로 찾으면 안 된다.** 일요일에 돌려 보고 알았는데, 그러면
 * "다음 토요일(09-05)" 과 "오늘 일요일(08-30)" 처럼 **서로 다른 주말의 이틀**이
 * 뒤죽박죽 순서로 잡힌다. 토요일을 먼저 정하고 일요일은 그 **다음 날**로 잡는다.
 * 그 일요일이 7일 예보 범위 밖이면(일요일에 돌린 경우가 그렇다) 토요일만 보낸다.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/** `2026-09-05` → `2026-09-06`. 월말·연말을 직접 계산하지 않으려고 Date 로 넘긴다. */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return next.toISOString().slice(0, 10);
}

export async function GET(request: Request): Promise<Response> {
  const denied = assertCron(request);
  if (denied) return denied;

  if (!hasWebhook()) {
    return NextResponse.json({ ok: false, reason: 'DISCORD_WEBHOOK_URL 없음' }, { status: 503 });
  }

  const forecast = await getForecast();
  const today = todayKst();

  const upcoming = forecast.days.map((day) => day.date).filter((date) => date >= today);
  const saturday = upcoming.find((date) => weekdayOf(date) === 6);
  // 같은 주말의 일요일 = 그 토요일의 다음 날. 예보 범위 안에 있을 때만 쓴다.
  const sunday = saturday
    ? upcoming.find((date) => date === nextDay(saturday))
    : upcoming.find((date) => weekdayOf(date) === 0);

  const days = [
    saturday && { date: saturday, label: '토요일' },
    sunday && { date: sunday, label: '일요일' },
  ].filter((day): day is { date: string; label: string } => Boolean(day));

  if (days.length === 0) {
    return NextResponse.json({ ok: false, reason: '예보 범위에 주말이 없음' }, { status: 200 });
  }

  const result = await sendWeekendOutlook(forecast.spots, days, siteUrl());
  return NextResponse.json({ ok: true, days: days.map((d) => d.date), ...result });
}
