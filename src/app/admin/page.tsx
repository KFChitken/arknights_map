import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminConsole from "@/components/admin/AdminConsole";
import { adminContext, gateState } from "@/lib/server/admins";

export const metadata: Metadata = { title: "管理台 · 舟P地图", robots: { index: false, follow: false } };

// who is signed in decides everything here
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

/** Nobody but the 管理台's own people learns there is a page here: anyone else gets the site's 404 */
export default async function Admin({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await adminContext();
  if (!ctx) notFound();
  const [gate, q] = await Promise.all([gateState(ctx), searchParams]);
  return <AdminConsole initial={gate} start={{ page: one(q.page), caseId: one(q.case), account: one(q.account) }} />;
}
