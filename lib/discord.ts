import {
  formatDate,
  formatRange,
  INDEX_LABELS,
  indexTone,
  looksLikeMissingLow,
  type NoonCode,
  type Slot,
  type Spot,
} from './fishing';

/**
 * Discord 알림.
 *
 * 웹훅 URL 은 그 자체가 인증수단이다(아는 사람은 누구나 그 채널에 메시지를 보낼 수 있다).
 * 절대 클라이언트에 노출하지 말고, 코드에도 적지 말고, 환경변수로만 받는다.
 */

/** Discord 는 메시지당 embed 10개가 상한이다. */
const MAX_EMBEDS = 10;

/** 알림에 넣을 지점 수. 10개를 다 채우면 읽지 않고 넘긴다. */
const TOP_N = 5;

export function hasWebhook(): boolean {
  return Boolean(process.env.DISCORD_WEBHOOK_URL?.trim());
}

/**
 * 웹훅 발송. 생성된 메시지 id 를 돌려준다.
 *
 * `?wait=true` 를 붙이면 Discord 가 204 대신 **생성된 메시지 객체**를 200 으로 준다.
 * 그냥 204 만 보면 "요청이 접수됐다"까지만 알 수 있는데, 이걸 쓰면 실제로 채널에
 * 메시지가 만들어진 것을 id 로 확인할 수 있다. 크론 응답에 그대로 실어 둔다.
 */
async function send(payload: unknown): Promise<string | null> {
  const url = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!url) throw new Error('DISCORD_WEBHOOK_URL 이 설정되지 않았습니다.');

  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // 웹훅 URL 이 에러 메시지에 섞여 로그로 새지 않도록 응답 본문만 잘라 남긴다.
    throw new Error(`Discord ${response.status}: ${body.slice(0, 200)}`);
  }

  const created = (await response.json().catch(() => null)) as { id?: string } | null;
  return created?.id ?? null;
}

/** `#38bdf8` → 0x38bdf8. 색은 화면과 같은 출처(`indexTone`)에서 가져온다. */
function embedColor(index: string): number {
  return Number.parseInt(indexTone(index).hex.slice(1), 16);
}

const NOON_LABEL: Record<NoonCode, string> = { 오전: '오전', 오후: '오후', 일: '종일' };

/**
 * 수온 표기.
 *
 * 원해 4개 지점은 최저 수온이 결측 자리표시자인 `0.1` 로 온다(실측 16건).
 * 알림에 `0.1~25.5℃` 를 그대로 쓰면 한겨울 바다처럼 읽힌다.
 * 값을 고치지는 않고, **최저값이 결측임을 밝히고 최고값만** 보여 준다.
 */
function waterTempText(slot: Slot): string {
  if (looksLikeMissingLow(slot.waterTemp)) {
    const max = slot.waterTemp.max;
    return max === null ? '—' : `${max.toFixed(1)}℃ (최저 결측)`;
  }
  return `${formatRange(slot.waterTemp)}℃`;
}

/** 대상어종 요약. 원해 지점은 어종이 `-` 로 와서 비어 있다. */
function fishText(slot: Slot): string {
  if (slot.fish.length === 0) return '대상어종 정보 없음 (원해)';
  return slot.fish
    .slice(0, 4)
    .map((fish) => `${fish.name} ${fish.index}`)
    .join(' · ');
}

/* ------------------------------------------------------------------ */

export interface Pick {
  spot: Spot;
  slot: Slot;
  score: number;
  index: string;
}

/**
 * 한 날짜의 지점별 최고 슬롯을 뽑아 지수 순으로 세운다.
 *
 * 왜 최고 슬롯인가: 반나절 출조가 보통이라 "오전이든 오후든 좋은 때가 있는가" 가
 * 실제 질문이다. 오전만 보고 줄을 세우면 오후가 좋은 지점이 통째로 묻힌다.
 * 어느 시간대인지는 알림에 함께 밝힌다.
 */
export function rankForDate(spots: Spot[], date: string): Pick[] {
  const picks: Pick[] = [];

  for (const spot of spots) {
    let best: Slot | null = null;
    for (const slot of spot.slots) {
      if (slot.date !== date) continue;
      if (!best || slot.bestScore > best.bestScore) best = slot;
    }
    if (best) picks.push({ spot, slot: best, score: best.bestScore, index: best.bestIndex });
  }

  return picks.sort((a, b) => b.score - a.score || a.spot.name.localeCompare(b.spot.name, 'ko'));
}

/** 5단계 분포를 `매우좋음 4 · 좋음 18 · …` 한 줄로. 0인 등급은 뺀다. */
function distributionLine(picks: Pick[]): string {
  return (
    INDEX_LABELS.map((label) => ({ label, count: picks.filter((p) => p.index === label).length }))
      .filter((entry) => entry.count > 0)
      .map((entry) => `${entry.label} ${entry.count}`)
      .join(' · ') || '자료 없음'
  );
}

function pickEmbed(pick: Pick, rank: number, siteUrl: string) {
  const { spot, slot } = pick;
  return {
    title: `${rank}. ${spot.name} · ${pick.index}`,
    url: siteUrl,
    color: embedColor(pick.index),
    description: fishText(slot),
    fields: [
      { name: '시간대', value: NOON_LABEL[slot.noon], inline: true },
      { name: '물때', value: slot.tide || '—', inline: true },
      { name: '파고', value: `${formatRange(slot.wave)}m`, inline: true },
      { name: '수온', value: waterTempText(slot), inline: true },
      { name: '풍속', value: `${formatRange(slot.wind)}m/s`, inline: true },
      { name: '해역', value: spot.region, inline: true },
    ],
  };
}

/**
 * 오늘(또는 지정일) 좋은 곳 알림.
 *
 * `매우좋음` 이 하루에 한 곳도 없는 날이 있다. 그때 "좋은 곳 없음"만 보내면 소음이라,
 * **등급과 무관하게 항상 상위 N곳을 지수와 함께** 보낸다. 전국 분포를 같이 실어
 * "오늘은 전반적으로 나쁘다" 를 한눈에 알 수 있게 한다.
 */
export async function sendDailyPicks(
  spots: Spot[],
  date: string,
  label: string,
  siteUrl: string,
): Promise<{ spots: number; messageId: string | null }> {
  const picks = rankForDate(spots, date);
  if (picks.length === 0) return { spots: 0, messageId: null };

  const top = picks.slice(0, Math.min(TOP_N, MAX_EMBEDS));

  const messageId = await send({
    content: `**${label} 바다낚시** · ${formatDate(date)}\n전국 ${picks.length}곳 — ${distributionLine(picks)}`,
    embeds: top.map((pick, i) => pickEmbed(pick, i + 1, siteUrl)),
  });

  return { spots: picks.length, messageId };
}

/**
 * 주말 전망.
 *
 * 토·일 각각을 embed 하나로 압축한다(지점마다 embed 를 쓰면 10개 상한에 바로 닿고
 * 읽히지도 않는다). 물때는 주말 내내 같은 경우가 많아 지점 목록 위에 따로 밝힌다.
 */
export async function sendWeekendOutlook(
  spots: Spot[],
  days: { date: string; label: string }[],
  siteUrl: string,
): Promise<{ embeds: number; messageId: string | null }> {
  const embeds = [];

  for (const day of days) {
    const picks = rankForDate(spots, day.date);
    if (picks.length === 0) continue;

    const top = picks.slice(0, TOP_N);
    const lines = top.map((pick, i) => {
      const { spot, slot } = pick;
      return [
        `**${i + 1}. ${spot.name}** (${spot.region}) — ${pick.index} · ${NOON_LABEL[slot.noon]}`,
        `파고 ${formatRange(slot.wave)}m · 수온 ${waterTempText(slot)} · 풍속 ${formatRange(slot.wind)}m/s`,
        fishText(slot),
      ].join('\n');
    });

    // 물때는 지점마다 같은 값이 오는 경우가 대부분이라 대표값으로 묶어 밝힌다.
    const tides = [...new Set(top.map((p) => p.slot.tide).filter(Boolean))];

    embeds.push({
      title: `${day.label} ${formatDate(day.date)}`,
      url: siteUrl,
      color: embedColor(top[0]!.index),
      description: [
        `물때 ${tides.join(' / ') || '—'} · 전국 ${distributionLine(picks)}`,
        '',
        ...lines,
      ]
        .join('\n\n')
        .slice(0, 4000),
    });
  }

  if (embeds.length === 0) return { embeds: 0, messageId: null };

  const messageId = await send({
    content: '**주말 바다낚시 전망**',
    embeds: embeds.slice(0, MAX_EMBEDS),
  });

  return { embeds: embeds.length, messageId };
}
