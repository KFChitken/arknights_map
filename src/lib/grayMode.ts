/**
 * 全站变灰 on a page: until when everything shows in gray, as the server said with the page (src/app/page.tsx,
 * src/components/GrayMode.tsx) and then with each answer of the roach feed (x-gray, src/lib/world/server.ts), so a
 * page left open follows within two minutes. It ends by itself at that time. While it is on, music stays off and new
 * badges wait to pop.
 */

/**
 * Filters the whole page to gray. On the root element, a filter leaves everything fixed where it is (on any other
 * element it would not), and the map is filtered with the rest. The map page (src/components/GrayMode.tsx) and the
 * intro page (src/app/about/route.ts) both say it.
 */
export const GRAY_CSS = "html{filter:grayscale(1)}";

let until: number | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

/** A timer runs this long at most */
const LONGEST_MS = 2 ** 31 - 1;

function keep(t: number | null) {
  const next = t !== null && Number.isFinite(t) && t > Date.now() ? t : null;
  if (next === until) return false;
  until = next;
  clearTimeout(timer);
  // and off again by itself at the time
  if (next !== null) timer = setTimeout(() => keep(null) && tell(), Math.min(next - Date.now(), LONGEST_MS));
  return true;
}

function tell() {
  for (const fn of listeners) fn();
}

/** What the page came with, before anything on it renders: kept without telling anyone, as nobody listens yet */
export function seedGray(t: number | null) {
  keep(t);
}

/** What the roach feed's x-gray says: until when (ms), 0 when the site is not gray; none (an older server) says nothing */
export function heardGray(header: string | null) {
  if (header === null) return;
  if (keep(Number(header) || null)) tell();
}

/** Whether the page is gray now */
export const isGray = () => until !== null && until > Date.now();

export function onGrayChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
