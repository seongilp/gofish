'use client';

import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import { INDEX_LABELS, indexTone, type Slot, type Spot } from '@/lib/fishing';

import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * 49개 예보지점 지도.
 *
 * 목록과 **같은 필터 결과**를 받는다. 지도가 스스로 필터링하면 목록과 어긋날 수 있어서,
 * 순위 계산은 부모가 한 번만 하고 그 결과(`rows`)를 목록과 지도가 같이 쓴다.
 * 색도 `indexTone` 한 곳에서만 가져온다 — 지도만 따로 팔레트를 두면 범례가 거짓말이 된다.
 */

/**
 * 키가 필요 없는 CARTO 다크 베이스맵. 전 세계 커버리지라 연안 타일도 정상으로 온다
 * (가거도·울릉도·제주까지 z10 벡터타일 200 응답을 직접 확인했다).
 */
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/**
 * 49개 예보지점의 실제 bbox. 여백은 여기서 부풀리지 않고 fitBounds 의 padding 으로만 준다.
 *
 * 예전엔 [[124.7, 32.9], [131.4, 38.8]] 처럼 데이터보다 넉넉한 상자를 썼는데, 그러면
 * 여백이 '경도·위도 여유'와 'padding' 두 곳에 흩어져 화면 크기별로 얼마가 남는지
 * 계산이 안 된다. 세로로 긴 폰에서 제주가 바닥에 붙어 버린 게 그 결과다.
 */
const KOREA_BOUNDS: [[number, number], [number, number]] = [
  [125.086, 33.238],
  [130.914, 38.45],
];

/**
 * 초기 fit 여백.
 *
 * 네 변을 따로 주는 이유는 가리는 것이 변마다 다르기 때문이다.
 *
 * 아래가 가장 크다: 라벨이 점 **아래**에 그려지고(`text-offset: [0, 1.1]`, 약 18px)
 * 그 아래에 저작권 배지(약 24px)가 깔린다. 최남단인 제주(서귀포·도두항)가 바닥에 붙어
 * 라벨이 배지에 먹히던 게 이 둘을 안 세어서 생긴 일이다. 18 + 24 + 여유.
 *
 * 좌우가 위보다 크다: 라벨은 점 기준 **가로 가운데** 정렬이라 가장 서쪽 지점
 * (`목포북항 서측(53km)`)의 라벨이 점의 절반 폭만큼 왼쪽으로 삐져나간다.
 * 좁은 화면에서 이게 `서측(53km)` 로 잘려 붙었다(라벨 접기는 text-max-width 로 따로 막는다).
 *
 * 실측: 393×668(브라우저 크롬을 뺀 실제 폰 높이)에서 지도 상자가 378px 까지 줄어드는데
 * 이 값이면 49지점이 전부 캔버스 안에 들어오고 최남단 서귀포가 아래 경계에서 56px 뜬다.
 */
const FIT_PADDING = { top: 24, right: 28, bottom: 48, left: 28 };
const FIT_PADDING_COMPACT = { top: 16, right: 32, bottom: 56, left: 32 };

const SOURCE = 'spots';

export interface MapRow {
  spot: Spot;
  slot: Slot;
  score: number;
  index: string;
}

function toGeoJson(rows: MapRow[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [row.spot.lon, row.spot.lat] },
      properties: {
        id: row.spot.id,
        name: row.spot.name,
        index: row.index,
        score: row.score,
        /*
         * 색을 피처에 미리 넣는다. 지도 안에서 match 표현식으로 다시 매핑하면
         * 팔레트가 두 곳에 생겨 목록 배지와 갈라질 수 있다. `indexTone` 한 곳만 남긴다.
         */
        color: indexTone(row.index).hex,
      },
    })),
  };
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function SpotMap({
  rows,
  selectedId,
  onSelect,
  compact = false,
  bottomInsetRatio = 0,
}: {
  rows: MapRow[];
  selectedId: string | null;
  onSelect: (spot: Spot) => void;
  /** 좁은 화면. 여백을 더 주고 지도 안 범례를 뺀다(위 분포 막대가 같은 역할을 한다). */
  compact?: boolean;
  /** 아래에서부터 바텀시트가 덮는 높이 비율(0~1). 선택 지점을 보이는 쪽으로 옮길 때 쓴다. */
  bottomInsetRatio?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const fittedRef = useRef(false);
  /* 클릭 핸들러는 지도 생성 시 한 번만 등록하므로 최신 콜백을 ref 로 들고 있는다. */
  const onSelectRef = useRef(onSelect);
  const rowsRef = useRef(rows);
  /* 지도 생성 effect 는 한 번만 돈다. 그 안에서 읽어야 하는 값은 ref 로 들고 있는다. */
  const compactRef = useRef(compact);
  const bottomInsetRef = useRef(bottomInsetRatio);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    compactRef.current = compact;
  }, [compact]);

  useEffect(() => {
    bottomInsetRef.current = bottomInsetRatio;
  }, [bottomInsetRatio]);

  /* 지도 생성 — 한 번만. */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      bounds: KOREA_BOUNDS,
      fitBoundsOptions: { padding: compactRef.current ? FIT_PADDING_COMPACT : FIT_PADDING },
      minZoom: 4,
      maxZoom: 12,
      attributionControl: { compact: true },
      /*
       * CARTO 글리프 서버에 한글이 없다. 44032-44287(한글 음절) 범위를 요청하면
       * 54바이트짜리 빈 응답이 온다 — 지점명 라벨이 통째로 안 보인다.
       * 이 옵션을 주면 한글 음절을 글리프 서버 대신 브라우저 폰트로 그린다.
       */
      localIdeographFontFamily: "'Noto Sans KR', sans-serif",
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      map.addSource(SOURCE, { type: 'geojson', data: toGeoJson(rowsRef.current) });

      // 선택 표시. 원 아래에 깔아 테두리처럼 보이게 한다.
      map.addLayer({
        id: 'spot-selected',
        type: 'circle',
        source: SOURCE,
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 11, 10, 18],
          'circle-color': 'transparent',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      map.addLayer({
        id: 'spot-circle',
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 6, 10, 11],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.9,
          'circle-stroke-color': '#0b0f19',
          'circle-stroke-width': 1.5,
        },
      });

      map.addLayer({
        id: 'spot-label',
        type: 'symbol',
        source: SOURCE,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 13],
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-allow-overlap': false,
          /*
           * 좁은 화면에서만 라벨을 두 줄로 접는다. `목포북항 서측(53km)` 같은 긴 이름이
           * 한 줄로 뻗으면 점 기준 가운데 정렬이라 서쪽 끝에서 왼쪽이 잘려 나간다.
           * 데스크톱은 폭이 남으니 기본값(10em)을 그대로 둔다.
           */
          'text-max-width': compactRef.current ? 6 : 10,
          /*
           * 줌이 낮으면 49개 라벨이 서로 충돌해 임의로 잘려 나간다.
           * sort-key 가 **작을수록** 먼저 배치돼 충돌에서 이긴다. 지수가 좋은 곳을
           * 남기고 싶으므로 점수를 뒤집어(5 - score) 넣는다.
           */
          'symbol-sort-key': ['-', 5, ['get', 'score']],
        },
        paint: {
          'text-color': '#e5e7eb',
          'text-halo-color': '#0b0f19',
          'text-halo-width': 1.2,
        },
      });

      loadedRef.current = true;
      map.getSource<maplibregl.GeoJSONSource>(SOURCE)?.setData(toGeoJson(rowsRef.current));
    });

    map.on('click', 'spot-circle', (event) => {
      const id = event.features?.[0]?.properties?.id as string | undefined;
      if (!id) return;
      const hit = rowsRef.current.find((row) => row.spot.id === id);
      if (hit) onSelectRef.current(hit.spot);
    });

    // 라벨을 눌러도 같은 지점이 열려야 한다. 모바일에서 원만 노리는 건 어렵다.
    map.on('click', 'spot-label', (event) => {
      const id = event.features?.[0]?.properties?.id as string | undefined;
      if (!id) return;
      const hit = rowsRef.current.find((row) => row.spot.id === id);
      if (hit) onSelectRef.current(hit.spot);
    });

    for (const layer of ['spot-circle', 'spot-label']) {
      map.on('mouseenter', layer, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
      });
    }

    /*
     * 컨테이너가 0x0 일 때 생성되면 생성자의 bounds 가 엉뚱한 줌으로 굳는다.
     * 실제 크기를 얻은 뒤 한 번 더 맞춘다.
     */
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 1 || box.height < 1) return;
      map.resize();
      if (fittedRef.current) return;
      fittedRef.current = true;
      map.fitBounds(KOREA_BOUNDS, {
        padding: compactRef.current ? FIT_PADDING_COMPACT : FIT_PADDING,
        duration: 0,
      });
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
      fittedRef.current = false;
    };
  }, []);

  /* 필터 결과가 바뀌면 점과 색을 갈아 끼운다. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.getSource<maplibregl.GeoJSONSource>(SOURCE)?.setData(rows.length ? toGeoJson(rows) : EMPTY);
  }, [rows]);

  /* 선택 강조. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setFilter('spot-selected', ['==', ['get', 'id'], selectedId ?? '']);
  }, [selectedId]);

  /* 브레이크포인트를 넘나들면 라벨 접힘 기준도 따라가야 한다. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setLayoutProperty('spot-label', 'text-max-width', compact ? 6 : 10);
  }, [compact]);

  /*
   * 고른 지점이 바텀시트에 가려졌거나 화면 밖이면 보이는 영역 가운데로 옮긴다.
   *
   * 줌은 건드리지 않는다. 지점을 고를 때마다 확대되면 "옆 지점으로 옮겨간다"는
   * 원래 동작이 깨지기 때문이다. 이미 잘 보이는 지점이면 아무것도 하지 않는다 —
   * 선택할 때마다 지도가 흔들리면 주변 지점과의 위치 관계를 잃는다.
   *
   * 의존성은 selectedId 하나다. 시트 높이를 사용자가 직접 바꿨을 때(peek↔full)까지
   * 지도를 따라 움직이면, 본인이 올린 시트 때문에 지도가 흔들리는 꼴이 된다.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !selectedId) return;
    const hit = rowsRef.current.find((row) => row.spot.id === selectedId);
    if (!hit) return;

    const el = map.getContainer();
    const visibleBottom = el.clientHeight * (1 - bottomInsetRef.current);
    // 마커 반지름 + 아래에 붙는 라벨이 들어갈 여유.
    const margin = 44;
    // 시트가 지도를 거의 다 덮었으면 어디로 옮겨도 안 보인다. 그냥 두는 게 낫다.
    if (visibleBottom < margin * 3) return;

    const point = map.project([hit.spot.lon, hit.spot.lat]);
    const visible =
      point.x >= margin &&
      point.x <= el.clientWidth - margin &&
      point.y >= margin &&
      point.y <= visibleBottom - margin;
    if (visible) return;

    map.panBy([point.x - el.clientWidth / 2, point.y - visibleBottom / 2], { duration: 400 });
  }, [selectedId]);

  return (
    <div className="relative size-full">
      {/*
        * maplibre-gl.css 가 `.maplibregl-map` 에 position:relative 를 걸어
        * Tailwind 의 `absolute inset-0` 을 이긴다. 그러면 높이가 0 이 되어 지도가 안 보인다.
        * 크기는 반드시 크기 유틸리티(size-full)로 직접 준다.
        */}
      <div ref={containerRef} className="size-full" />

      {/*
        범례. 색은 목록 배지와 같은 출처에서 온다.

        좁은 화면에서는 그리지 않는다. 세로 120px · 가로 77px 짜리 상자가 좌하단을
        차지하는데 하필 거기가 서남해(목포·가거도·하조도) 마커 자리라 점이 상자 뒤로
        반쯤 숨었다. 바로 위 분포 막대가 같은 팔레트로 같은 범례를 이미 보여 주므로
        지도 안에 한 벌 더 둘 이유가 없다.
      */}
      {!compact && (
        <div className="bg-card/90 border-border pointer-events-none absolute bottom-2 left-2 rounded-lg border px-2.5 py-2 backdrop-blur">
          <div className="text-muted-foreground mb-1 text-[10px]">바다낚시지수</div>
          <div className="flex flex-col gap-0.5">
            {INDEX_LABELS.map((label) => (
              <span key={label} className="text-muted-foreground flex items-center gap-1.5 text-[10px]">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: indexTone(label).hex }}
                />
                {label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
