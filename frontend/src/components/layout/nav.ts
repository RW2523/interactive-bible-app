import { BookOpen, Compass, Home, Library, Network, PenLine, Search, ShieldCheck, Upload, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** path prefixes that also mark this item active */
  match?: string[];
  /** path prefixes that must NOT mark this item active */
  exclude?: string[];
  description: string;
  /** compact label for the phone tab bar */
  short?: string;
  /** extra words the command palette matches on */
  keywords?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV = {
  home: { to: "/", label: "Home", icon: Home, description: "Your daily starting point", keywords: "start dashboard today" },
  read: { to: "/read", label: "Read", icon: BookOpen, match: ["/read", "/verse"], description: "The Bible with verse-by-verse insights", keywords: "bible chapter verse reader" },
  search: { to: "/search", label: "Search & Ask", icon: Search, match: ["/search"], description: "Find passages by meaning and ask questions", keywords: "find ask ai question semantic" },
  library: { to: "/library", label: "Library", icon: Library, match: ["/library", "/resources", "/clip"], description: "Sermons, podcasts and studies linked to Scripture", keywords: "resources videos audio podcasts pdf" },
  map: { to: "/map", label: "Scripture Map", icon: Network, match: ["/map"], description: "See how verses, themes and people connect", keywords: "graph connections themes network" },
  explore: { to: "/explore", label: "Explore", icon: Compass, match: ["/explore"], description: "Atlas, timeline, family line and story videos", keywords: "atlas map timeline family tree lineage stories events" },
  sermons: { to: "/sermons", label: "Sermon Studio", short: "Sermons", icon: PenLine, match: ["/sermons"], description: "Prepare, design and publish sermons", keywords: "sermon preach slides publish write" },
  ingest: { to: "/admin/ingest", label: "Add to library", icon: Upload, match: ["/admin/ingest"], description: "Upload a sermon, podcast, PDF or article", keywords: "upload import add ingest" },
  admin: { to: "/admin", label: "Admin", icon: ShieldCheck, match: ["/admin"], exclude: ["/admin/ingest"], description: "Review mappings, processing and system health", keywords: "review queue settings system metrics" },
} satisfies Record<string, NavItem>;

/** The seven main modules, in sidebar order (kept for existing imports). */
export const PRIMARY_NAV: NavItem[] = [NAV.home, NAV.read, NAV.search, NAV.library, NAV.map, NAV.explore, NAV.sermons];

export function navGroups({ signedIn, isEditor }: { signedIn: boolean; isEditor: boolean }): NavGroup[] {
  const groups: NavGroup[] = [
    { id: "study", label: "Read & study", items: [NAV.home, NAV.read, NAV.search, NAV.library, NAV.map] },
    { id: "create", label: "Create & explore", items: [NAV.explore, NAV.sermons] },
  ];
  if (signedIn) groups.push({ id: "workspace", label: "Workspace", items: isEditor ? [NAV.ingest, NAV.admin] : [NAV.ingest] });
  return groups;
}

export const MOBILE_TABS: NavItem[] = [NAV.home, NAV.read, NAV.explore, NAV.sermons];

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.to === "/") return pathname === "/";
  const hit = (m: string) => pathname === m || pathname.startsWith(`${m}/`);
  if (item.exclude?.some(hit)) return false;
  return (item.match || [item.to]).some(hit);
}
