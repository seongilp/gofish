/**
 * 크론 라우트 인증.
 *
 * 이 라우트들은 Discord 로 메시지를 보내고 외부 API 를 18페이지 전수 호출한다.
 * 공개돼 있으면 누구나 우리 채널에 도배하고 data.go.kr 일 10,000 한도를 태울 수 있다.
 *
 * Vercel Cron 은 요청에 `Authorization: Bearer $CRON_SECRET` 을 붙여 준다.
 * CRON_SECRET 이 설정돼 있지 않으면 **거부**한다 — 실수로 열어두는 쪽보다 낫다.
 */
export function assertCron(request: Request): Response | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return new Response('CRON_SECRET 이 설정되지 않았습니다.', { status: 503 });
  }

  const header = request.headers.get('authorization');
  if (header !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  return null;
}

/**
 * 절대 URL. Discord embed 의 링크는 상대경로로는 안 된다.
 *
 * `NEXT_PUBLIC_` 접두사를 쓰지 않는다. 이 값은 서버에서만 읽는데 접두사를 붙이면
 * 클라이언트 번들에 박히고, Vercel 도 public 접두사 변수는 Production/Preview 에서
 * sensitive 로 못 두게 막는다(실제로 거부당했다).
 *
 * 폴백인 `VERCEL_PROJECT_PRODUCTION_URL` 은 Vercel 이 자동 배정한 도메인
 * (gofish-woad.vercel.app)이라 실제 별칭과 다르다. 그래서 SITE_URL 을 명시한다.
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : 'https://gofish-kr.vercel.app';
}
