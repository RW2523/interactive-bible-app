import {
  Activity, ChartColumn, History, LayoutDashboard, ListChecks, Loader2, MessageSquareWarning, ServerCog, ShieldCheck, Tags, Upload, type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { matchPath, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useReviewQueue } from "@/api/hooks";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { useAdminFeedback, useSystemStatus } from "./adminApi";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: "review" | "feedback" | "processing";
  editorOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: "Library",
    items: [
      { to: "/admin/ingest", label: "Add to library", icon: Upload },
      { to: "/admin/resources", label: "Processing monitor", icon: Activity, badge: "processing", editorOnly: true },
    ],
  },
  {
    label: "Review",
    items: [
      { to: "/admin/review", label: "Review queue", icon: ListChecks, badge: "review", editorOnly: true },
      { to: "/admin/feedback", label: "Feedback", icon: MessageSquareWarning, badge: "feedback", editorOnly: true },
      { to: "/admin/audit", label: "Audit history", icon: History, editorOnly: true },
    ],
  },
  {
    label: "Insights & settings",
    items: [
      { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true, editorOnly: true },
      { to: "/admin/metrics", label: "Metrics", icon: ChartColumn, editorOnly: true },
      { to: "/admin/vocabulary", label: "Topics & entities", icon: Tags, editorOnly: true },
      { to: "/admin/system", label: "System & AI", icon: ServerCog, editorOnly: true },
    ],
  },
];

function useBadges(enabled: boolean) {
  const queue = useReviewQueue({ status: "open", page_size: 1 }, enabled);
  const feedback = useAdminFeedback({ status: "open", page_size: 1 }, enabled);
  const system = useSystemStatus(enabled);
  const busy = Number(system.data?.queue?.queued || 0) + Number(system.data?.queue?.running || 0);
  return {
    review: Number(queue.data?.facets?.open || 0),
    feedback: Number(feedback.data?.total || 0),
    processing: busy,
  };
}

function Badge({ kind, value, active, compact }: { kind: NonNullable<NavItem["badge"]>; value: number; active?: boolean; compact?: boolean }) {
  if (!value) return null;
  if (kind === "processing") {
    return (
      <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-link" title={`${value} item${value === 1 ? "" : "s"} processing`}>
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {!compact && <span className="tabular-nums">{value}</span>}
        <span className="sr-only">{value} processing</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums",
        active ? "bg-white/20 text-current dark:bg-navy-950/15" : "bg-gold-400 text-navy-950",
      )}
    >
      {value > 99 ? "99+" : value}
      <span className="sr-only">{kind === "review" ? " waiting for review" : " new reports"}</span>
    </span>
  );
}

export function AdminLayout() {
  const { viewer, loading, isEditor } = useAuth();
  const location = useLocation();
  const badges = useBadges(!!viewer?.authenticated && isEditor);
  const railScroller = useRef<HTMLDivElement>(null);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => isEditor || !i.editorOnly) })).filter((g) => g.items.length);
  const active = NAV.flatMap((g) => g.items).find((i) => matchPath({ path: i.to, end: !!i.end }, location.pathname));

  // Keep the active tab visible in the horizontal (phone/tablet) navigation.
  useEffect(() => {
    const center = () => {
      const box = railScroller.current;
      const el = box?.querySelector<HTMLElement>("[aria-current='page']");
      if (box && el && box.clientWidth) box.scrollLeft = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2;
    };
    center();
    let t = 0;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(center, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(t);
    };
  }, [location.pathname, loading]);

  // A more specific browser-tab title than the app-wide "Admin".
  useEffect(() => {
    if (!active) return;
    // after App's own title effect (parents run their effects after children)
    const id = window.setTimeout(() => {
      document.title = `${active.label} · Admin · Interactive Bible App`;
    }, 0);
    return () => window.clearTimeout(id);
  }, [active, location.pathname]);

  if (loading) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-ink-2" role="status">
        <Loader2 className="size-6 animate-spin" aria-label="Loading admin" />
      </div>
    );
  }
  if (!viewer?.authenticated) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!isEditor && !location.pathname.startsWith("/admin/ingest")) return <Navigate to="/admin/ingest" replace />;

  return (
    <div className="min-h-[calc(100dvh-var(--header-h))] xl:grid xl:grid-cols-[248px_minmax(0,1fr)]">
      {/* wide screens: grouped side rail */}
      <aside className="hidden border-r border-border bg-paper-2/70 xl:block" aria-label="Admin">
        <div className="no-scrollbar sticky top-[var(--header-h)] max-h-[calc(100dvh-var(--header-h))] overflow-y-auto px-3 pt-6 pb-8">
          <div className="mb-5 flex items-center gap-3 px-2">
            <span className="grid size-9 place-items-center rounded-xl bg-navy-700 text-white shadow-xs dark:bg-gold-400 dark:text-navy-950" aria-hidden>
              <ShieldCheck className="size-[18px]" />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="font-display text-[17px] font-semibold text-ink">Admin</p>
              <p className="text-xs text-ink-2">Manage your library</p>
            </div>
          </div>
          <nav aria-label="Admin sections" className="grid grid-cols-1 gap-5">
            {groups.map((g, gi) => (
              <div key={g.label} role="group" aria-labelledby={`admin-nav-group-${gi}`}>
                <p id={`admin-nav-group-${gi}`} className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-ink-2 uppercase">
                  {g.label}
                </p>
                <ul className="grid grid-cols-1 gap-0.5">
                  {g.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                          cn(
                            "group flex min-h-10 items-center gap-3 rounded-xl border px-3 py-2 text-sm font-medium no-underline transition hover:no-underline",
                            isActive ? "border-border bg-card text-ink shadow-xs" : "border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon className={cn("size-[18px] shrink-0", isActive ? "text-gold-600 dark:text-gold-300" : "text-ink-3 group-hover:text-ink-2")} aria-hidden />
                            <span className="truncate">{item.label}</span>
                            {item.badge && <Badge kind={item.badge} value={badges[item.badge]} />}
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      <div className="min-w-0">
        {/* phones and tablets: one scrollable row of sections */}
        <nav aria-label="Admin sections" className="border-b border-border bg-paper/90 backdrop-blur-xl md:sticky md:top-[var(--header-h)] md:z-30 xl:hidden">
          <div ref={railScroller} className="no-scrollbar relative mx-auto flex max-w-[1400px] items-center gap-1.5 overflow-x-auto px-4 py-2.5 sm:px-6 lg:px-8">
            <span className="mr-1 hidden shrink-0 items-center gap-1.5 text-sm font-semibold text-ink sm:inline-flex">
              <ShieldCheck className="size-4 text-gold-600 dark:text-gold-300" aria-hidden /> Admin
            </span>
            {groups.map((g, gi) => (
              <Fragment key={g.label}>
                {gi > 0 && <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />}
                <div role="group" aria-label={g.label} className="flex shrink-0 gap-1.5">
                  {g.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap no-underline transition hover:no-underline",
                          isActive
                            ? "border-transparent bg-navy-700 text-white shadow-xs dark:bg-gold-400 dark:text-navy-950"
                            : "border-border bg-card text-ink-2 hover:border-gold-400/50 hover:text-ink",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon className="size-4 shrink-0" aria-hidden />
                          {item.label}
                          {item.badge && <Badge kind={item.badge} value={badges[item.badge]} active={isActive} compact />}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </Fragment>
            ))}
          </div>
        </nav>
        <Outlet />
      </div>
    </div>
  );
}
