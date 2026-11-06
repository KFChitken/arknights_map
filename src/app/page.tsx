import { headers } from "next/headers";
import { preconnect } from "react-dom";
import MapApp from "@/components/MapApp";
import { ipFrom } from "@/lib/server/http";
import { inMainland } from "@/lib/server/region";

/** The map. Visitors from mainland China get Amap only, told from their address here and never stored. */
export default async function Home() {
  const cn = inMainland(ipFrom(await headers()));
  // Mainland visitors load Amap's map code next: its connection opens while our page is still downloading
  if (cn) preconnect("https://webapi.amap.com");
  return <MapApp cn={cn} />;
}
