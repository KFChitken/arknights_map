/* eslint-disable @typescript-eslint/no-explicit-any -- Tencent's JavaScript API GL ships no types */
export type TMapNS = any;

declare global {
  interface Window {
    TMap?: TMapNS;
  }
}

/** The same key as the place suggestions' (src/lib/tencent.ts): its map needs no service of its own turned on */
const KEY = process.env.NEXT_PUBLIC_TENCENT_KEY ?? "";

export const tencentConfigured = Boolean(KEY);

let loading: Promise<TMapNS> | null = null;

/** Load Tencent's map (JavaScript API GL) once per page; later calls reuse it, and a failed load is tried again. */
export function loadTMap(): Promise<TMapNS> {
  if (!loading) {
    loading = new Promise<TMapNS>((resolve, reject) => {
      if (!KEY) return reject(new Error("NoKey"));
      if (window.TMap) return resolve(window.TMap);
      const script = document.createElement("script");
      script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(KEY)}`;
      script.async = true;
      script.onload = () => (window.TMap?.Map ? resolve(window.TMap) : reject(new Error("NoTMap")));
      script.onerror = () => {
        script.remove();
        reject(new Error("ScriptError"));
      };
      document.head.appendChild(script);
    }).catch((e: unknown) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}
