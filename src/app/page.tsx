import { headers } from "next/headers";
import MapApp from "@/components/MapApp";
import { ipFrom } from "@/lib/server/http";
import { inMainland } from "@/lib/server/region";

/** The map. Visitors from mainland China get Amap only, told from their address here and never stored. */
export default async function Home() {
  return <MapApp cn={inMainland(ipFrom(await headers()))} />;
}
