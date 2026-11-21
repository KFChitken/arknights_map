"use client";

import { T } from "@/i18n";
import { useStreamDown } from "./stream";

/** 「连接断了，正在重连…」 at the top of a room (一起卫戍's, 一起听's player) while the page's event stream is down (stream.ts) */
export default function StreamDown({ className }: { className?: string }) {
  if (!useStreamDown()) return null;
  return (
    <p className={className ? `stream-down ${className}` : "stream-down"} role="status">
      {T.common.streamDown}
    </p>
  );
}
