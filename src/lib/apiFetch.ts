import { lang } from "@/i18n";
import { LANG_HEADER } from "@/i18n/lang";

/**
 * fetch, for the site's own /api: the English site's page says it is English (src/i18n/lang.ts),
 * so the server answers in English, its refusals and its mail included. A Chinese page asks
 * exactly as fetch would.
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const l = lang();
  if (l === "zh") return init === undefined ? fetch(input) : fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set(LANG_HEADER, l);
  return fetch(input, { ...init, headers });
}
