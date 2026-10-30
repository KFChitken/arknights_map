import { MIN_SIGNUP_AGE } from "./rules";

/**
 * The consents asked for on their own: at sign-up, again by older accounts after
 * the privacy policy changed (POLICY_UPDATED_AT), and before the first roach goes
 * down. Only the time of each is stored.
 */
export const ADULT_TICK = `我已满 ${MIN_SIGNUP_AGE} 岁`;
export const CROSS_BORDER_TICK = "我同意把我的信息存到腾讯云香港服务器，并由 Resend USA 发送验证码邮件";
export const PUBLIC_PLACE_TICK = "我同意注册舟P和网站游客看到我放下的蟑螂的确切位置";
/** Said once, before the first roach a player puts down */
export const PUBLIC_PLACE_NOTE = "放下以后，注册舟P和网站游客都能看到这只蟑螂的确切位置。请不要放在家门口。";

export type Tick = "adult" | "acceptPolicy" | "acceptCrossBorder" | "acceptPublicPlace";

/** What the server says when a request leaves a tick out. */
export const TICK_MISSING: Record<Tick, string> = {
  adult: `需要确认你已满 ${MIN_SIGNUP_AGE} 岁。`,
  acceptPolicy: "需要先同意隐私说明。",
  acceptCrossBorder: "需要先同意信息存放和发信的说明。",
  acceptPublicPlace: "需要先同意公开蟑螂位置的说明。",
};
