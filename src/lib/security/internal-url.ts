/**
 * Shared SSRF guard. Refuses URLs that point at loopback, link-local,
 * AWS / GCP metadata endpoints, RFC-1918 private ranges, IPv6 literals,
 * or `.internal` / `.local` corporate suffixes.
 *
 * Not a substitute for a network-level egress firewall — DNS rebinding
 * can still resolve to an internal IP at fetch time. But it filters
 * the obvious cases at config-write time and at fetch-time for any
 * server-side fetcher.
 *
 * Used by:
 *   - /api/admin/webhooks (config-time gate)
 *   - lib/workflows/actions.ts webhook action (fetch-time gate)
 *   - any future server-side fetcher that takes a user-supplied URL.
 */
export function isInternalUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return true;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return true;
  const host = u.hostname.toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [parseInt(ipv4[1], 10), parseInt(ipv4[2], 10)];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + AWS IMDS
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a >= 224) return true;
  }
  if (host.startsWith("[") || host.includes(":")) return true;
  if (host.endsWith(".internal") || host.endsWith(".local")) return true;
  return false;
}
