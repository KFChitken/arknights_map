/** Product limits in one place so they are easy to tune. */

/** The site's name as players see it. */
export const SITE_NAME = "粥P地图";

export const MIN_SIGNUP_AGE = 14;
export const LOGIN_CODE_TTL_MIN = 10;
export const LOGIN_CODE_COOLDOWN_S = 60;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
/** Codes one email address may receive per day, so nobody can use us to flood an inbox. */
export const LOGIN_CODES_PER_DAY = 10;
export const SESSION_DAYS = 30;

/** Clones a player may place besides the main roach. */
export const MAX_CLONES = 3;

/** Favourite characters per game. */
export const MAX_FAVOURITES = 3;

export const NAME_MAX = 16;
export const UID_MAX = 20;

export const DECLARATION_RADIUS_KM = 10;
export const DECLARATION_COOLDOWN_MIN = 1;
export const DECLARATIONS_PER_DAY = 20;

/** Touches one player may send per day, and the wait before touching the same roach again. */
export const TOUCHES_PER_DAY = 60;
export const TOUCH_SAME_ROACH_HOURS = 24;

/** Inbox items older than this are not shown. */
export const INBOX_DAYS = 30;
/** Touches, declarations, reactions and roach moves older than this are deleted (see the privacy page). */
export const KEEP_ACTIVITY_DAYS = 90;

/** 方舟雷达 scans this far around your main roach. */
export const RADAR_RADIUS_KM = 100;
