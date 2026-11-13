import { redirect } from "next/navigation";
import { englishOn } from "@/i18n/server";

/** The English site (src/i18n/lang.ts): the Chinese one's pages, in English. ENGLISH=off leads to the Chinese map. */
export default function English({ children }: { children: React.ReactNode }) {
  if (!englishOn()) redirect("/");
  return children;
}
