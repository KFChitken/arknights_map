import type { RoachAvatar, RoachColor } from "./types";

/** Why one player may report another, worded as the reporter picks it. */
export const REPORT_REASONS = {
  name: "名字不合适",
  spam: "骚扰刷屏",
  minor: "可能不满 14 岁",
  other: "其他",
} as const;

export type ReportReason = keyof typeof REPORT_REASONS;

export const isReportReason = (r: unknown): r is ReportReason => typeof r === "string" && Object.hasOwn(REPORT_REASONS, r);

/** What the admin page shows about one reported player: their open reports and what they did lately. */
export type AdminCase = {
  targetId: string;
  /** The name as saved, even while they are anonymous */
  name: string;
  anonymous: boolean;
  avatar: RoachAvatar;
  color: RoachColor;
  joinedAt: number;
  last24h: { touches: number; declarations: number };
  declarations: { text: string; at: number }[];
  reporters: number;
  reports: { reason: ReportReason; note: string; context: string; name: string; at: number }[];
};

export type AdminAction = "dismiss" | "clearName" | "ban";
