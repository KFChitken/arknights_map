/**
 * A likely fix for a mistyped email domain (gmial.com → gmail.com), for the sign-in sheet to
 * suggest. It is never applied by itself: the player taps it or not. Codes sent to a mistyped
 * address bounce (835 in 15 days, 2026-11), and bounces count against the site's sending name.
 */

// The domains most players here use, more common first
const DOMAINS = [
  "qq.com",
  "163.com",
  "gmail.com",
  "126.com",
  "outlook.com",
  "foxmail.com",
  "icloud.com",
  "hotmail.com",
  "vip.qq.com",
  "sina.com",
  "yeah.net",
  "139.com",
  "sohu.com",
  "aliyun.com",
  "live.com",
  "msn.com",
  "me.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
];

// Seen in the bounces (2026-11) and too far from their domain for the edit rule below
const KNOWN_TYPOS: Record<string, string> = { "pp.com": "qq.com" };

/** Edits between two strings, a swap of two neighbours counting as one */
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The address with its domain fixed, when the domain is one edit (two, for long ones) from exactly one common domain */
export function suggestEmail(email: string): string | null {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at < 1) return null;
  const local = email.trim().slice(0, at);
  const domain = email.trim().toLowerCase().slice(at + 1);
  if (!/\.[a-z]{2,}$/.test(domain) || DOMAINS.includes(domain)) return null;
  if (Object.hasOwn(KNOWN_TYPOS, domain)) return `${local}@${KNOWN_TYPOS[domain]}`;
  // .com typed twice: qq.com.com, 163.comcom
  const doubled = /^(.+\.com)\.?com$/.exec(domain)?.[1];
  if (doubled && DOMAINS.includes(doubled)) return `${local}@${doubled}`;
  let best: string | null = null;
  let bestDistance = Infinity;
  let tied = false;
  for (const known of DOMAINS) {
    const d = distance(domain, known);
    const near = d === 1 || (d === 2 && Math.min(domain.length, known.length) >= 9);
    if (!near) continue;
    if (d < bestDistance) [best, bestDistance, tied] = [known, d, false];
    else if (d === bestDistance) tied = true;
  }
  return best && !tied ? `${local}@${best}` : null;
}
