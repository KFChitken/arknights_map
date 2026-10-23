import type { Metadata } from "next";
import AdminApp from "@/components/AdminApp";
import { SITE_NAME } from "@/lib/rules";

export const metadata: Metadata = { title: `举报处理 · ${SITE_NAME}`, robots: { index: false } };

export default function Admin() {
  return <AdminApp />;
}
