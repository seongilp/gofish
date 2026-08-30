'use client';

import { useSyncExternalStore } from 'react';

/**
 * Tailwind 의 xl 브레이크포인트(1280px) 미만을 '좁은 화면'으로 본다.
 *
 * 상세 패널을 우측에 붙이는 기준이 원래 `xl:block` 이었으므로 그 값을 그대로 쓴다.
 * 여기서 브레이크포인트를 바꾸면 정상 동작 중인 데스크톱·태블릿 레이아웃이 같이 움직인다.
 */
const COMPACT_QUERY = '(max-width: 1279.98px)';

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(COMPACT_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * 좁은 화면(<1280px) 여부. 상세를 우측 패널 대신 바텀시트/모달로 띄우는 구간이다.
 *
 * CSS 로 숨기는(`xl:hidden`) 대신 렌더 자체를 갈라야 하는 이유가 있다. 패널과 시트
 * 양쪽에 SpotDetail 을 두고 한쪽만 숨기면 상세가 항상 두 번 마운트된다. 지금은
 * 부모가 받아 둔 데이터를 props 로 넘길 뿐이라 네트워크 낭비는 없지만, 7일 추이
 * 히트맵(최대 10열 × 어종 행)이 두 벌 그려지고 상세에 언젠가 자체 로딩이 붙는 순간
 * 그대로 중복 호출이 된다. 애초에 하나만 존재하게 만든다.
 *
 * effect + setState 대신 useSyncExternalStore 를 쓴다. 연쇄 렌더가 없고 서버
 * 스냅샷을 따로 줄 수 있어 하이드레이션 불일치도 안 난다.
 */
export function useIsCompact(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COMPACT_QUERY).matches,
    // 서버에는 뷰포트가 없다. 데스크톱으로 그려 두고 하이드레이션 후 정정한다.
    // 상세는 사용자가 지점을 고른 뒤에만 렌더되므로 첫 페인트에 깜빡임이 없다.
    () => false,
  );
}
