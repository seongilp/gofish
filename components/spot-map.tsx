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

/** 남한 연안 예보지점(lat 33.24~38.45 / lon 125.09~130.91)을 전부 감싸는 경계. */
const KOREA_BOUNDS: [[number, number], [number, number]] = [
  [124.7, 32.9],
  [131.4, 38.8],
];

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
}: {
  rows: MapRow[];
  selectedId: string | null;
  onSelect: (spot: Spot) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const fittedRef = useRef(false);
  /* 클릭 핸들러는 지도 생성 시 한 번만 등록하므로 최신 콜백을 ref 로 들고 있는다. */
  const onSelectRef = useRef(onSelect);
  const rowsRef = useRef(rows);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  /* 지도 생성 — 한 번만. */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      bounds: KOREA_BOUNDS,
      fitBoundsOptions: { padding: 24 },
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
      map.fitBounds(KOREA_BOUNDS, { padding: 24, duration: 0 });
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

  return (
    <div className="relative size-full">
      {/*
        * maplibre-gl.css 가 `.maplibregl-map` 에 position:relative 를 걸어
        * Tailwind 의 `absolute inset-0` 을 이긴다. 그러면 높이가 0 이 되어 지도가 안 보인다.
        * 크기는 반드시 크기 유틸리티(size-full)로 직접 준다.
        */}
      <div ref={containerRef} className="size-full" />

      {/* 범례. 색은 목록 배지와 같은 출처에서 온다. */}
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
    </div>
  );
}
