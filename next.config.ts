import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /*
   * 상위 디렉토리(~/)에 pnpm-workspace.yaml 이 있어서 Turbopack 이 루트를 그쪽으로 잡으려다
   * 경고를 뱉는다. 이 앱은 독립 프로젝트이므로 루트를 자기 자신으로 못 박는다.
   */
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
