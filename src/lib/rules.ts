/** Product limits in one place so they are easy to tune. */

/** The site's name as players see it. */
export const SITE_NAME = "舟P地图";

export const MIN_SIGNUP_AGE = 18;
/**
 * The last change to the privacy policy big enough to ask everyone again. Accounts
 * that agreed before it see 「隐私说明更新了」 and do nothing others see until they
 * agree (src/lib/server/consent.ts). Small wording fixes only change the page's date.
 */
export const POLICY_UPDATED_AT = new Date("2026-10-31T00:00+08:00");
export const LOGIN_CODE_TTL_MIN = 10;
export const LOGIN_CODE_COOLDOWN_S = 120;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
/** Codes one email address may receive per day, so nobody can use us to flood an inbox. */
export const LOGIN_CODES_PER_DAY = 10;
export const SESSION_DAYS = 30;

/** Clones a player may place besides the main roach. */
export const MAX_CLONES = 5;

/** Favourite characters per game. */
export const MAX_FAVOURITES = 3;

export const NAME_MAX = 16;
export const UID_MAX = 20;

export const DECLARATION_RADIUS_KM = 10;
export const DECLARATION_COOLDOWN_MIN = 1;
export const DECLARATIONS_PER_DAY = 20;

/** Moves of a roach already on the map, and new roaches put down, per player in any 24 hours. */
export const MOVES_PER_DAY = 3;
export const PLACEMENTS_PER_DAY = 8;

/** 方舟雷达 scans per player in any 24 hours; reopening it within a few minutes shows the same scan for free. */
export const RADAR_SCANS_PER_DAY = 5;
export const RADAR_REUSE_MIN = 10;

/** Touches one player may send per day, and the wait before touching the same roach again. */
export const TOUCHES_PER_DAY = 60;
export const TOUCH_SAME_ROACH_HOURS = 24;
/**
 * Touches one player may make a day on another player's roaches, main and clones together,
 * touching back included. Touching back is only for someone not touched in the last day, so
 * touches never go back and forth (Breeze, 2026-11-10).
 */
export const TOUCHES_PER_PERSON_PER_DAY = 3;
/** 戳一戳: how often one player may poke the same 触须之交's sleeping roach. */
export const POKE_EVERY_DAYS = 7;

/**
 * Reports one player may file per day, and how many different players reporting what someone wrote
 * about themselves (src/lib/safety.ts PROFILE_REASONS) hold their name and UIDs until the admin looks.
 */
export const REPORTS_PER_DAY = 10;
export const PROFILE_REPORTS_TO_HOLD = 3;
export const REPORT_NOTE_MAX = 100;
/** A report for 「其他」 says what happened in at least this many characters */
export const OTHER_NOTE_MIN = 2;
/**
 * A reporter the automatic steps count: an account this many days old, and not one whose reports the
 * admin often found nothing in (at least UNRELIABLE_DISMISSED_MIN of them, and twice as many as upheld).
 */
export const RELIABLE_AFTER_DAYS = 3;
export const UNRELIABLE_DISMISSED_MIN = 3;
export const UNRELIABLE_DISMISSED_RATIO = 2;
/** 暂停互动 lasts this many days */
export const SUSPEND_DAYS = 7;
/** Yellow cards count over this many days, and this many may well end in a ban (the admin decides) */
export const YELLOW_DAYS = 90;
export const YELLOWS_TO_WORRY = 3;
/** Blocked by this many different players within BLOCKS_WINDOW_DAYS makes a case of its own for the admin */
export const BLOCKS_TO_REVIEW = 10;
export const BLOCKS_WINDOW_DAYS = 7;
/** What the admin did about players is kept this long (see the privacy page) */
export const KEEP_MOD_ACTION_DAYS = 365;
/** Handled reports are deleted after this many days (see the privacy page). */
export const KEEP_REPORT_DAYS = 90;

/** Accounts this young still get the newcomer tutorial. */
export const NEWCOMER_DAYS = 7;

/** Inbox items older than this are not shown. */
export const INBOX_DAYS = 30;
/**
 * And of the declarations that reached you, and of the replies to yours, only this many of the
 * newest: a busy neighbourhood sends hundreds a day.
 */
export const INBOX_DECLARATIONS = 100;
/** Touches, pokes, declarations, reactions and roach moves older than this are deleted (see the privacy page). */
export const KEEP_ACTIVITY_DAYS = 90;

/** 方舟雷达 scans this far around your main roach. */
export const RADAR_RADIUS_KM = 100;
