/* Links meant for other people (sermon share pages, verse links). On the computer running the app the browser address
   is usually localhost, which opens nowhere else, so /v1/auth/me reports a better base: PUBLIC_BASE_URL ("config") or
   this computer's address on the local network ("lan"). */

export interface ShareBase {
  share_base_url?: string | null;
  share_base_url_source?: "config" | "lan" | null;
}

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;
let known: ShareBase | null = null;

/** AuthProvider records the latest /v1/auth/me answer so code outside React can build links too. */
export function rememberShareBase(info: ShareBase | null | undefined) {
  known = info ?? null;
}

function onThisComputer() {
  return LOOPBACK.test(window.location.hostname);
}

function shareOrigin(info: ShareBase | null | undefined): string {
  const base = info?.share_base_url;
  if (base && (info?.share_base_url_source === "config" || onThisComputer())) return base;
  return window.location.origin;
}

/** Absolute URL for a path someone else will open. */
export function shareableUrl(path: string, info: ShareBase | null | undefined = known): string {
  return new URL(path, shareOrigin(info)).href;
}

/** Who can open a shared link: only this computer, devices on this network, or unknown (configured or already remote). */
export function shareReach(info: ShareBase | null | undefined = known): "this-device" | "network" | "unknown" {
  if (info?.share_base_url_source === "config" || !onThisComputer()) return "unknown";
  return info?.share_base_url ? "network" : "this-device";
}
