/**
 * The notice every signed-in player sees before anything else (src/components/app/NoticeSheet.tsx), each
 * time they come (Breeze, 11/11): on every sign-in, a newcomer's first too, and on opening the map once per
 * visit. A visit is this tab until it is closed, so reloading the page does not bring it back, while a new
 * tab, or opening the site again after closing it, does.
 */
export const NOTICE_ID = "2026-11-11";

const key = (userId: string) => `zhoup.notice.${NOTICE_ID}.${userId}`;

/** Closed already during this visit */
export function noticeSeen(userId: string) {
  try {
    return sessionStorage.getItem(key(userId)) === "1";
  } catch {
    // storage blocked: shown on every load rather than never
    return false;
  }
}

export function markNoticeSeen(userId: string) {
  try {
    sessionStorage.setItem(key(userId), "1");
  } catch {
    // storage blocked: nothing to remember it in
  }
}
