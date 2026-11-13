import type { Metadata } from "next";
import { EN_MANIFEST } from "@/i18n/lang";
import { generateMetadata as privacyMetadata } from "../../privacy/page";

// The privacy notice, in English (src/app/en/layout.tsx)
export { default } from "../../privacy/page";

export const generateMetadata = (): Metadata => ({ ...privacyMetadata(), manifest: EN_MANIFEST });
