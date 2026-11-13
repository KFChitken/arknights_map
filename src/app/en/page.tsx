import type { Metadata } from "next";
import { EN_MANIFEST } from "@/i18n/lang";

// The map, in English (src/app/en/layout.tsx)
export { default } from "../page";

export const metadata: Metadata = { manifest: EN_MANIFEST };
