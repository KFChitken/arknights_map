/** Product limits in one place so they are easy to tune. */

/** Clones a player may place besides the main roach. */
export const MAX_CLONES = 3;

/** Favourite characters per game. */
export const MAX_FAVOURITES = 3;

export const NAME_MAX = 16;
export const UID_MAX = 20;

/** Edge of the grid cell public positions are snapped to. */
export const FUZZ_CELL_KM = 1;

export const DECLARATION_RADIUS_KM = 10;
export const DECLARATION_COOLDOWN_MIN = 1;
export const DECLARATIONS_PER_DAY = 20;

/** Touches one player may send per day, and the wait before touching the same roach again. */
export const TOUCHES_PER_DAY = 60;
export const TOUCH_SAME_ROACH_HOURS = 24;

/** Inbox items older than this are not shown. */
export const INBOX_DAYS = 30;

/** 方舟雷达 scans this far around your main roach. */
export const RADAR_RADIUS_KM = 100;
