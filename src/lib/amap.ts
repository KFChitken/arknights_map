/* eslint-disable @typescript-eslint/no-explicit-any -- the Amap JS API ships no official types */
export type AMapNS = any;

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode?: string; serviceHost?: string };
  }
}

let loading: Promise<AMapNS> | null = null;

/** Load the Amap JS API once per page; later calls reuse it. */
export function loadAMap(): Promise<AMapNS> {
  if (!loading) {
    window._AMapSecurityConfig = {
      securityJsCode: process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE,
    };
    // The loader touches window as soon as it is imported, so keep it out of server rendering
    loading = import("@amap/amap-jsapi-loader")
      .then(({ default: AMapLoader }) =>
        AMapLoader.load({
          key: process.env.NEXT_PUBLIC_AMAP_KEY!,
          version: "2.0",
          plugins: ["AMap.HeatMap", "AMap.Scale", "AMap.ToolBar"],
        }),
      )
      .catch((e: unknown) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

/** Load extra Amap plugins on demand. */
export async function amapPlugins(...names: string[]): Promise<AMapNS> {
  const AMap = await loadAMap();
  await new Promise<void>((resolve) => AMap.plugin(names, () => resolve()));
  return AMap;
}
