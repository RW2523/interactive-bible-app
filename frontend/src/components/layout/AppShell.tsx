import { Drawer } from "@base-ui/react/drawer";
import {
  BookOpen, ChevronsLeft, ChevronsRight, LogIn, LogOut, Menu, Moon, PenLine, Search, Settings2, ShieldCheck, Sparkles, Sun, Upload, UserRound, WifiOff, X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/useTheme";
import { cn, initials } from "@/lib/utils";
import { useOnline } from "../ui";
import { CommandPalette, isMacLike, openCommandPalette, toggleCommandPalette } from "./CommandPalette";
import { isNavActive, MOBILE_TABS, navGroups, type NavItem } from "./nav";

export { PRIMARY_NAV } from "./nav";
export { useScriptureJump } from "@/lib/scripture";
export { openCommandPalette } from "./CommandPalette";

const COLLAPSE_KEY = "ibible_sidebar_collapsed";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("brand-gradient grid grid-cols-1 size-9 shrink-0 place-items-center rounded-xl text-navy-900 shadow-md shadow-gold-700/20 ring-1 ring-gold-700/10", className)} aria-hidden>
      <BookOpen className="size-[18px]" strokeWidth={2.2} />
    </span>
  );
}

/* ───────────────────────────── account */

function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { viewer, updateProfile, singleUser } = useAuth();
  const [name, setName] = useState("");
  const [church, setChurch] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(viewer?.display_name || "");
      setChurch(viewer?.church || "");
      setCurrent("");
      setNext("");
    }
  }, [open, viewer]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await updateProfile({ display_name: name.trim(), church: church.trim(), ...(next ? { current_password: current, new_password: next } : {}) });
      toast.success("Profile saved", { description: "Your name and church now appear on sermons you publish." });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update your profile");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-md">
        <form onSubmit={save}>
          <DialogHeader className="gap-1 px-6 pt-6 pb-2">
            <div className="mb-3 flex items-center gap-3">
              <span className="grid grid-cols-1 size-12 place-items-center rounded-full bg-navy-700 font-semibold text-white dark:bg-gold-400 dark:text-navy-900">{initials(name || viewer?.display_name)}</span>
              <div className="min-w-0">
                <DialogTitle className="font-display text-xl font-semibold">Your profile</DialogTitle>
                <DialogDescription className="text-ink-3">{singleUser ? "Owner of this computer" : viewer?.email}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 px-6 pb-6">
            <p className="rounded-xl bg-surface-2/70 px-3 py-2.5 text-[13px]/relaxed text-ink-2 dark:bg-white/[0.04]">Your name and church are shown on sermons you publish and share.</p>
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="profile-name">Name</Label>
              <Input id="profile-name" className="h-10 rounded-xl" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="name" />
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              <Label htmlFor="profile-church">Church or ministry <span className="font-normal text-ink-3">(optional)</span></Label>
              <Input id="profile-church" className="h-10 rounded-xl" value={church} onChange={(e) => setChurch(e.target.value)} maxLength={120} placeholder="e.g. Grace Community Church" />
            </div>
            {!singleUser && (
              <details className="rounded-xl border border-border p-3 text-sm">
                <summary className="font-medium text-ink-2">Change password</summary>
                <div className="mt-3 grid grid-cols-1 gap-3">
                  <Input type="password" className="h-10 rounded-xl" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" aria-label="Current password" />
                  <Input type="password" className="h-10 rounded-xl" placeholder="New password (8+ characters)" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} autoComplete="new-password" aria-label="New password" />
                </div>
              </details>
            )}
          </div>
          <DialogFooter className="mx-0 mb-0 rounded-none px-6 py-4">
            <Button type="button" variant="ghost" className="h-9 rounded-xl px-4" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="h-9 rounded-xl px-5" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save profile"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Avatar({ name, className }: { name?: string | null; className?: string }) {
  return (
    <span className={cn("grid grid-cols-1 size-9 shrink-0 place-items-center rounded-full bg-navy-700 text-xs font-semibold tracking-wide text-white ring-2 ring-paper-2 dark:bg-gold-400 dark:text-navy-900", className)} aria-hidden>
      {initials(name)}
    </span>
  );
}

/** Account dropdown. `trigger` is the element that opens it. */
function AccountMenu({ trigger, triggerClassName, side = "top", align = "start", onProfile }: { trigger: ReactNode; triggerClassName?: string; side?: "top" | "bottom"; align?: "start" | "end"; onProfile: () => void }) {
  const { viewer, logout, isEditor, singleUser } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClassName} aria-label="Account and settings">{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} sideOffset={8} className="w-64 min-w-64 rounded-xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2">
            <Avatar name={viewer?.display_name} className="size-10 ring-0" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{viewer?.display_name}</span>
              <span className="block truncate text-xs font-normal text-ink-3">{singleUser ? "Owner · full access on this computer" : viewer?.email}</span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem className="gap-2.5 rounded-lg px-2 py-2" onClick={onProfile}><UserRound className="size-4 text-ink-3" /> Profile</DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5 rounded-lg px-2 py-2" onClick={toggleTheme}>
            {theme === "dark" ? <Sun className="size-4 text-ink-3" /> : <Moon className="size-4 text-ink-3" />}
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem className="gap-2.5 rounded-lg px-2 py-2" onClick={() => navigate("/sermons")}><PenLine className="size-4 text-ink-3" /> My sermons</DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5 rounded-lg px-2 py-2" onClick={() => navigate("/admin/ingest")}><Upload className="size-4 text-ink-3" /> Add to library</DropdownMenuItem>
          {isEditor && <DropdownMenuItem className="gap-2.5 rounded-lg px-2 py-2" onClick={() => navigate("/admin")}><ShieldCheck className="size-4 text-ink-3" /> Admin</DropdownMenuItem>}
        </DropdownMenuGroup>
        {!singleUser && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2.5 rounded-lg px-2 py-2"
              onClick={async () => {
                await logout();
                toast.success("Signed out");
                navigate("/");
              }}
            >
              <LogOut className="size-4 text-ink-3" /> Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SignInButton({ compact }: { compact?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <Button
      variant="outline"
      size={compact ? "icon-lg" : "lg"}
      className={cn("rounded-xl", !compact && "w-full justify-center gap-2")}
      onClick={() => navigate("/login", { state: { from: location.pathname + location.search } })}
      aria-label="Sign in"
    >
      <LogIn className="size-4" />
      {!compact && "Sign in"}
    </Button>
  );
}

function IconAction({ label, onClick, children, className, side = "top" }: { label: string; onClick: () => void; children: ReactNode; className?: string; side?: "top" | "right" | "bottom" }) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        aria-label={label}
        className={cn("grid grid-cols-1 size-9 shrink-0 place-items-center rounded-xl text-ink-3 transition outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-3 focus-visible:ring-ring dark:hover:bg-white/[0.06]", className)}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Bottom-of-sidebar owner card: who you are, plus quick profile and theme controls. */
function OwnerCard({ collapsed }: { collapsed?: boolean }) {
  const { viewer, singleUser } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  if (!viewer?.authenticated) return <SignInButton compact={collapsed} />;
  const role = singleUser ? "Owner" : viewer.role.charAt(0).toUpperCase() + viewer.role.slice(1);
  const themeLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <>
      {collapsed ? (
        <div className="grid grid-cols-1 justify-items-center gap-1">
          <IconAction label={themeLabel} onClick={toggleTheme} side="right">
            {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </IconAction>
          <AccountMenu
            side="top"
            onProfile={() => setProfileOpen(true)}
            triggerClassName="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring"
            trigger={<Avatar name={viewer.display_name} />}
          />
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-1 rounded-2xl border border-border bg-card p-1.5 shadow-xs dark:bg-white/[0.03]">
          <AccountMenu
            side="top"
            onProfile={() => setProfileOpen(true)}
            triggerClassName="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1 text-left outline-none transition hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring dark:hover:bg-white/[0.05]"
            trigger={
              <>
                <Avatar name={viewer.display_name} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm font-semibold text-ink">{viewer.display_name}</span>
                  <span className="block truncate text-xs text-ink-3">{viewer.church ? `${role} · ${viewer.church}` : role}</span>
                </span>
              </>
            }
          />
          <IconAction label="Edit profile" onClick={() => setProfileOpen(true)}>
            <Settings2 className="size-[18px]" />
          </IconAction>
          <IconAction label={themeLabel} onClick={toggleTheme}>
            {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </IconAction>
        </div>
      )}
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}

/* ───────────────────────────── navigation */

function SidebarLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed?: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const active = isNavActive(item, pathname);
  const Icon = item.icon;
  const className = cn(
    "group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium no-underline outline-none transition-colors hover:no-underline focus-visible:ring-3 focus-visible:ring-ring",
    active
      ? "bg-card text-ink shadow-xs ring-1 ring-border dark:bg-white/[0.07] dark:text-gold-100 dark:ring-white/10"
      : "text-ink-2 hover:bg-surface-2/80 hover:text-ink dark:hover:bg-white/[0.04]",
    collapsed && "w-10 justify-center px-0",
  );
  const content = (
    <>
      {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-gold-500 dark:bg-gold-400" aria-hidden />}
      <Icon className={cn("size-[18px] shrink-0", active ? "text-navy-700 dark:text-gold-300" : "text-ink-3 group-hover:text-ink-2")} aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </>
  );
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger render={<NavLink to={item.to} end={item.to === "/"} onClick={onNavigate} aria-current={active ? "page" : undefined} aria-label={item.label} className={className} />}>
          {content}
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={10}>
          <span className="block font-semibold">{item.label}</span>
          <span className="block font-normal text-white/70">{item.description}</span>
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <NavLink to={item.to} end={item.to === "/"} onClick={onNavigate} aria-current={active ? "page" : undefined} className={className}>
      {content}
    </NavLink>
  );
}

function NavSections({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { viewer, isEditor } = useAuth();
  const groups = navGroups({ signedIn: !!viewer?.authenticated, isEditor });
  return (
    <div className="grid grid-cols-1 gap-5">
      {groups.map((g) => (
        <div key={g.id} role="group" aria-label={g.label}>
          {collapsed ? (
            <div className="mx-auto mb-2 h-px w-6 bg-border first:hidden" aria-hidden />
          ) : (
            <div className="mb-1.5 px-3 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{g.label}</div>
          )}
          <div className={cn("grid grid-cols-1 gap-0.5", collapsed && "justify-items-center")}>
            {g.items.map((item) => (
              <SidebarLink key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-paper-2 transition-[width] duration-200 lg:flex", collapsed ? "w-[72px]" : "w-[var(--sidebar-w)]")}
      aria-label="Main navigation"
    >
      <div className={cn("flex h-16 shrink-0 items-center gap-3 px-4", collapsed && "justify-center px-0")}>
        <Link to="/" className="flex min-w-0 items-center gap-3 rounded-xl no-underline outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-ring" aria-label="Interactive Bible App — Home">
          <BrandMark />
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-display text-[17px] font-semibold tracking-tight text-ink">Interactive Bible</span>
              <span className="block text-[11px] font-medium tracking-wide text-ink-3">Read · Explore · Preach</span>
            </span>
          )}
        </Link>
      </div>
      <nav className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-4">
        <NavSections collapsed={collapsed} />
      </nav>
      <div className={cn("grid shrink-0 grid-cols-[minmax(0,1fr)] gap-2 border-t border-border p-3", collapsed && "justify-items-center px-2")}>
        <OwnerCard collapsed={collapsed} />
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex h-8 items-center gap-2 rounded-lg px-2 text-xs font-medium text-ink-3 transition outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-3 focus-visible:ring-ring dark:hover:bg-white/[0.05]",
            collapsed ? "w-10 justify-center px-0" : "w-full",
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          {!collapsed && "Collapse sidebar"}
        </button>
      </div>
    </aside>
  );
}

function SearchTrigger({ className, compact, onBeforeOpen }: { className?: string; compact?: boolean; onBeforeOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        onBeforeOpen?.();
        openCommandPalette();
      }}
      className={cn(
        "group flex h-10 min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface/80 px-3 text-left text-sm text-ink-3 shadow-xs transition outline-none hover:border-line-2 hover:bg-surface hover:text-ink-2 focus-visible:ring-3 focus-visible:ring-ring dark:bg-white/[0.04] dark:hover:bg-white/[0.07]",
        className,
      )}
      aria-label="Search Scripture, jump to a passage, or go to a page"
      aria-keyshortcuts={isMacLike ? "Meta+K" : "Control+K"}
    >
      <Search className="size-4 shrink-0 text-ink-3 group-hover:text-ink-2" aria-hidden />
      {compact ? (
        <span className="min-w-0 flex-1 truncate">Search or jump to…</span>
      ) : (
        <span className="min-w-0 flex-1 truncate">
          <span className="sm:hidden">Search or jump to a passage…</span>
          <span className="hidden sm:inline">Search Scripture, jump to a passage…</span>
        </span>
      )}
      {!compact && (
        <span className="hidden shrink-0 items-center gap-1 sm:flex" aria-hidden>
          <kbd className="kbd-hint">{isMacLike ? "⌘" : "Ctrl"}</kbd>
          <kbd className="kbd-hint">K</kbd>
        </span>
      )}
    </button>
  );
}

function MobileAccountButton() {
  const { viewer } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  if (!viewer?.authenticated) return <SignInButton compact />;
  return (
    <>
      <AccountMenu
        side="bottom"
        align="end"
        onProfile={() => setProfileOpen(true)}
        triggerClassName="grid grid-cols-1 size-10 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring"
        trigger={<Avatar name={viewer.display_name} className="size-8 ring-0" />}
      />
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}

function MobileDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const close = () => onOpenChange(false);
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="left">
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-[70] bg-navy-950/50 opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-300 data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0 lg:hidden" />
        <Drawer.Viewport className="fixed inset-0 z-[70] flex items-stretch justify-start lg:hidden">
          <Drawer.Popup
            className="flex h-full w-[min(86vw,320px)] flex-col bg-paper-2 shadow-2xl outline-none [transform:translateX(var(--drawer-swipe-movement-x,0px))] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:[transform:translateX(-100%)] data-starting-style:[transform:translateX(-100%)] data-swiping:duration-0 data-swiping:select-none"
            aria-label="Menu"
          >
            <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4 pt-[env(safe-area-inset-top)]">
              <Link to="/" onClick={close} className="flex min-w-0 items-center gap-3 no-underline hover:no-underline">
                <BrandMark />
                <span className="min-w-0 leading-tight">
                  <Drawer.Title className="block truncate font-display text-[17px] font-semibold text-ink">Interactive Bible</Drawer.Title>
                  <span className="block text-[11px] font-medium text-ink-3">Read · Explore · Preach</span>
                </span>
              </Link>
              <Drawer.Close className="grid grid-cols-1 size-10 place-items-center rounded-xl text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close menu">
                <X className="size-5" />
              </Drawer.Close>
            </div>
            <div className="px-4 pb-2">
              <SearchTrigger compact className="w-full" onBeforeOpen={close} />
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-4" aria-label="All pages">
              <NavSections onNavigate={close} />
            </nav>
            <div className="shrink-0 border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <OwnerCard />
            </div>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function MobileTabs({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const { pathname } = useLocation();
  const inTabs = MOBILE_TABS.some((t) => isNavActive(t, pathname));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-paper-2/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden dark:bg-navy-950/90" aria-label="Primary">
      <div className="mx-auto grid h-[60px] max-w-lg grid-cols-5 px-1">
        {MOBILE_TABS.map((item) => {
          const active = isNavActive(item, pathname);
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className="flex flex-col items-center justify-center gap-0.5 no-underline outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset"
              aria-current={active ? "page" : undefined}
            >
              <span className={cn("grid grid-cols-1 h-7 w-14 place-items-center rounded-full transition-colors", active ? "bg-navy-700/10 text-navy-800 dark:bg-gold-400/15 dark:text-gold-300" : "text-ink-3")}>
                <Icon className="size-[20px]" strokeWidth={active ? 2.3 : 2} aria-hidden />
              </span>
              <span className={cn("text-[11px] leading-tight", active ? "font-semibold text-ink" : "font-medium text-ink-3")}>{item.short || item.label}</span>
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={onMore}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          className="flex flex-col items-center justify-center gap-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className={cn("grid grid-cols-1 h-7 w-14 place-items-center rounded-full transition-colors", !inTabs || moreOpen ? "bg-navy-700/10 text-navy-800 dark:bg-gold-400/15 dark:text-gold-300" : "text-ink-3")}>
            <Menu className="size-[20px]" aria-hidden />
          </span>
          <span className={cn("text-[11px] leading-tight", !inTabs ? "font-semibold text-ink" : "font-medium text-ink-3")}>More</span>
        </button>
      </div>
    </nav>
  );
}

/* ───────────────────────────── shell */

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [drawer, setDrawer] = useState(false);
  const online = useOnline();
  const location = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => setDrawer(false), [location.pathname]);

  // New pages start at the top (but not when a clip opens over the current page, or on back/forward).
  const lastPath = useRef(location.pathname);
  const lastHadBackground = useRef(false);
  useEffect(() => {
    const hasBackground = !!(location.state as { background?: unknown } | null)?.background;
    if (location.pathname !== lastPath.current && !hasBackground && !lastHadBackground.current && navigationType !== "POP") {
      window.scrollTo({ top: 0 });
    }
    lastPath.current = location.pathname;
    lastHadBackground.current = hasBackground;
  }, [location, navigationType]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !e.defaultPrevented) {
        e.preventDefault();
        openCommandPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });

  return (
    <TooltipProvider>
      <div className="flex min-h-dvh bg-background text-foreground">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-md">
          Skip to content
        </a>
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-[var(--header-h)] shrink-0 items-center gap-2 border-b border-border bg-paper/85 px-3 backdrop-blur-xl sm:gap-3 sm:px-4 lg:px-6">
            <Link to="/" className="grid grid-cols-1 shrink-0 place-items-center rounded-xl no-underline outline-none hover:no-underline focus-visible:ring-3 focus-visible:ring-ring lg:hidden" aria-label="Interactive Bible App — Home">
              <BrandMark className="size-9" />
            </Link>
            <SearchTrigger className="w-full max-w-xl flex-1 lg:mx-auto" />
            <div className="flex shrink-0 items-center gap-1 lg:hidden">
              <MobileAccountButton />
            </div>
            <Link
              to="/search?ask=1"
              className="hidden h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-ink-2 no-underline transition hover:bg-surface-2 hover:text-ink hover:no-underline lg:flex dark:hover:bg-white/[0.06]"
            >
              <Sparkles className="size-4 text-gold-600 dark:text-gold-400" aria-hidden /> Ask AI
            </Link>
          </header>
          {!online && (
            <div className="flex items-center justify-center gap-2 border-b border-warn/20 bg-warn-soft px-3 py-1.5 text-center text-[13px] text-warn" role="status">
              <WifiOff className="size-3.5 shrink-0" aria-hidden /> You're offline — pages you've opened stay readable; AI features return when you reconnect.
            </div>
          )}
          <main id="main" className="min-w-0 flex-1 pb-[var(--bottom-nav-h)] lg:pb-0">
            {children}
          </main>
        </div>
        <MobileTabs onMore={() => setDrawer(true)} moreOpen={drawer} />
        <MobileDrawer open={drawer} onOpenChange={setDrawer} />
        <CommandPalette />
      </div>
    </TooltipProvider>
  );
}
