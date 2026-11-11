/**
 * The notice every signed-in player sees once, before anything else, on coming back to the map or on
 * signing in, a newcomer's first sign-in too (src/components/app/NoticeSheet.tsx). A new notice gets a
 * new id, so everyone sees that one too. Remembered in this browser.
 */
export const NOTICE_ID = "2026-11-11";

const key = (userId: string) => `zhoup.notice.${NOTICE_ID}.${userId}`;

export function noticeSeen(userId: string) {
  try {
    return localStorage.getItem(key(userId)) === "1";
  } catch {
    // storage blocked: shown each visit rather than never
    return false;
  }
}

export function markNoticeSeen(userId: string) {
  try {
    localStorage.setItem(key(userId), "1");
  } catch {
    // storage blocked: nothing to remember it in
  }
}
