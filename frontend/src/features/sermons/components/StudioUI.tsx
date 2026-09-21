import {
  ArrowLeft, Check, ChevronDown, Clock, Copy, Images, Info, Layers, Loader2, LogIn, Share2, Sparkles, UserPlus, Wand2, type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useState, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ───────────────────────────────────────────────────────────── layout

export const PAGE = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

/** Icon tile used by section headers, empty states and choice cards. */
export function IconTile({ icon: Icon, className, size = "md" }: { icon: LucideIcon; className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-gold-400/12 text-gold-600 dark:bg-gold-400/10 dark:text-gold-300",
        size === "sm" && "size-8 rounded-lg [&_svg]:size-4",
        size === "md" && "size-10 rounded-xl [&_svg]:size-[18px]",
        size === "lg" && "size-12 rounded-2xl [&_svg]:size-6",
        className,
      )}
      aria-hidden
    >
      <Icon />
    </span>
  );
}

export function SectionCard({
  icon,
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  id,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const autoId = useId();
  const headingId = id ? `${id}-title` : `section-${autoId}`;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("scroll-mt-[calc(var(--header-h)+5rem)] rounded-2xl border border-border bg-card shadow-xs", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
          {icon && <IconTile icon={icon} />}
          <div className="min-w-0 self-center">
            <h2 id={headingId} className="font-display text-lg leading-snug font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {description && <div className="mt-0.5 text-sm leading-relaxed text-ink-2">{description}</div>}
          </div>
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{action}</div>}
      </header>
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function FieldLabel({ htmlFor, children, hint, className }: { htmlFor?: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-1.5 flex items-baseline justify-between gap-2", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink-2">
        {children}
      </label>
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-input bg-surface px-3 text-[15px] text-ink shadow-xs outline-none transition placeholder:text-ink-3 focus:border-gold-500/60 focus:ring-3 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60 dark:bg-surface-2/50 sm:text-sm";

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputClass, "h-11 sm:h-10", className)} {...props} />;
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputClass, "min-h-28 resize-y py-2.5 leading-relaxed", className)} {...props} />;
}

export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select className={cn(inputClass, "h-11 cursor-pointer appearance-none pr-9 sm:h-10", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
    </div>
  );
}

/** Accessible on/off switch built on a native checkbox. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3", disabled && "cursor-not-allowed opacity-60", className)}>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition peer-focus-visible:ring-3 peer-focus-visible:ring-ring",
          checked ? "border-transparent bg-primary" : "border-border bg-surface-2",
        )}
      >
        <span className={cn("inline-block size-[18px] rounded-full bg-white shadow-sm transition", checked ? "translate-x-[22px]" : "translate-x-[2px]")} />
      </span>
      <span className="min-w-0 text-sm">
        <span className="block font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{description}</span>}
      </span>
    </label>
  );
}

/**
 * A large selectable option (format, tone, visual type…): icon, title and a short description.
 * Rendered as a toggle button inside a labelled group.
 */
export function ChoiceCard({
  selected,
  onSelect,
  icon: Icon,
  title,
  description,
  disabled,
  className,
  compact,
}: {
  selected: boolean;
  onSelect: () => void;
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "group relative flex min-w-0 flex-col items-start gap-1.5 rounded-xl border text-left transition outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
        compact ? "p-2.5 sm:p-3" : "min-h-[104px] p-3",
        selected
          ? "border-gold-500/70 bg-gold-400/10 shadow-xs ring-1 ring-gold-400/40 dark:bg-gold-400/10"
          : "border-border bg-surface hover:border-gold-400/50 hover:bg-paper-2 dark:bg-surface-2/30 dark:hover:bg-surface-2/60",
        className,
      )}
    >
      {selected && (
        <span className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-gold-500 text-white dark:bg-gold-400 dark:text-navy-900" aria-hidden>
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
      {Icon && (
        <span
          className={cn(
            "grid size-8 place-items-center rounded-lg transition",
            selected ? "bg-gold-400 text-navy-900" : "bg-surface-2 text-ink-2 group-hover:text-ink dark:bg-surface-2",
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
      )}
      <span className="pr-5 text-[13px] leading-tight font-semibold text-ink sm:text-sm">{title}</span>
      {description && <span className="text-xs leading-snug text-ink-3">{description}</span>}
    </button>
  );
}

// ───────────────────────────────────────────────────────────── status

const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-surface-2 text-ink-2" },
  polished: { label: "Polished", className: "bg-[var(--rel-direct-soft)] text-[var(--rel-direct)]" },
  multimedia: { label: "Visuals added", className: "bg-[var(--rel-ai-soft)] text-[var(--rel-ai)]" },
  exported: { label: "Ready to publish", className: "bg-[var(--gold-soft)] text-gold-700 dark:text-gold-300" },
  published: { label: "Published", className: "bg-[var(--ok-soft)] text-ok" },
};

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const s = STATUS[status ?? "draft"] ?? STATUS.draft;
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap", s.className, className)}>
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {s.label}
    </span>
  );
}

export interface StageInfo {
  n: 1 | 2 | 3 | 4;
  label: string;
  long: string;
  title: string;
  desc: string;
  guide: string;
  icon: LucideIcon;
}

export const STAGES: StageInfo[] = [
  {
    n: 1,
    label: "Collect",
    long: "Collect content",
    title: "Collect your content",
    desc: "Notes, voice & Scripture",
    guide: "Type notes, speak, upload a recording or document, and add Bible passages.",
    icon: Layers,
  },
  {
    n: 2,
    label: "Polish",
    long: "Polish & edit",
    title: "Polish your sermon",
    desc: "An AI draft you can edit",
    guide: "AI shapes everything into a clear sermon in your format, tone and language — then you refine it.",
    icon: Wand2,
  },
  {
    n: 3,
    label: "Visuals",
    long: "Add visuals",
    title: "Add visuals",
    desc: "Artwork, maps & slides",
    guide: "Optional: create illustrations, maps, timelines and Scripture slides for the big screen.",
    icon: Images,
  },
  {
    n: 4,
    label: "Publish",
    long: "Present & publish",
    title: "Present & publish",
    desc: "Export & share",
    guide: "Download a PDF or PowerPoint, get speaker notes and social posts, and publish a page for your church.",
    icon: Share2,
  },
];

export function StageBars({ stage, className, label }: { stage: number; className?: string; label?: string }) {
  return (
    <span className={cn("flex gap-1", className)} role="img" aria-label={label ?? `${stage} of 4 steps done`}>
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={cn("h-1.5 flex-1 rounded-full transition-colors", n <= stage ? "bg-gold-400" : "bg-surface-2 dark:bg-surface-2")} />
      ))}
    </span>
  );
}

/** The opening lines of a workspace step: which step this is, and what to do next. */
export function StageIntro({ stage, children, aside }: { stage: 1 | 2 | 3 | 4; children: ReactNode; aside?: ReactNode }) {
  const info = STAGES[stage - 1];
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="mt-1 hidden size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-gold-400 to-gold-600 text-navy-900 shadow-md shadow-gold-700/15 sm:grid" aria-hidden>
          <info.icon className="size-[22px]" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.12em] text-gold-700 uppercase dark:text-gold-300">Step {stage} of 4</p>
          <h2 className="mt-1 font-display text-2xl leading-tight font-semibold tracking-tight text-ink sm:text-[28px]">{info.title}</h2>
          <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-ink-2">{children}</p>
        </div>
      </div>
      {aside && <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div>}
    </div>
  );
}

/** Small pill used for counts and statuses next to headings. */
export function MetaPill({ icon: Icon, children, tone = "neutral", className }: { icon?: LucideIcon; children: ReactNode; tone?: "neutral" | "gold" | "ok"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        tone === "neutral" && "bg-surface-2 text-ink-2",
        tone === "gold" && "bg-[var(--gold-soft)] text-gold-700 dark:text-gold-300",
        tone === "ok" && "bg-[var(--ok-soft)] text-ok",
        className,
      )}
    >
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  );
}

// ───────────────────────────────────────────────────────────── clipboard

export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* permission denied or unsupported (e.g. embedded browsers) — try the legacy path */
    }
  }
  // Fallback for plain-http LAN access (no async clipboard API) and restricted contexts.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("copy failed");
}

export function CopyButton({
  text,
  label = "Copy",
  withText,
  className,
  variant = "ghost",
  toastMessage = "Copied to clipboard",
}: {
  text: string;
  label?: string;
  withText?: boolean;
  className?: string;
  variant?: "ghost" | "outline";
  toastMessage?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await copyToClipboard(text);
      setCopied(true);
      toast.success(toastMessage);
    } catch {
      toast.error("Couldn't copy", { description: "Select the text and copy it manually." });
    }
  };
  return (
    <Button
      type="button"
      variant={variant}
      size={withText ? "sm" : "icon"}
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={label}
      className={cn(
        withText ? "h-9 gap-1.5 rounded-lg px-2.5 sm:h-8" : "size-10 rounded-lg sm:size-8",
        variant === "ghost" && "text-ink-3 hover:text-ink",
        className,
      )}
    >
      {copied ? <Check className="text-ok" /> : <Copy />}
      {withText && <span>{copied ? "Copied" : label}</span>}
    </Button>
  );
}

// ───────────────────────────────────────────────────────────── AI progress

export function useElapsedSince(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
}

export function formatDuration(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A one-line explanation shown next to an AI button before it runs: what happens and how long it takes. */
export function AiNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-xs leading-relaxed text-ink-3", className)}>
      <Clock className="mt-[3px] size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Friendly progress for AI calls that take 10–120 s: status, rotating hints, an estimate and elapsed time. */
export function AiProgress({
  since,
  label,
  hints,
  estimate = "less than a minute",
  note = "You can keep working; it's saved automatically.",
  className,
}: {
  since: number | null;
  label: string;
  hints?: string[];
  estimate?: string;
  /** What the owner can do meanwhile / what happens to the result. */
  note?: string;
  className?: string;
}) {
  const elapsed = useElapsedSince(since);
  if (!since) return null;
  const hint = hints?.length ? hints[Math.min(hints.length - 1, Math.floor(elapsed / 8))] : "Working on it…";
  const slow = elapsed > 90;
  return (
    <div role="status" aria-live="polite" className={cn("overflow-hidden rounded-xl border border-gold-400/35 bg-gold-400/[0.07] dark:bg-gold-400/[0.06]", className)}>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-gold-400/15 text-gold-600 dark:text-gold-300" aria-hidden>
          <Loader2 className="absolute size-10 animate-spin opacity-40" strokeWidth={1.2} />
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">{label}</div>
          <div className="text-[13px] text-ink-2">{hint}</div>
          <div className="mt-0.5 text-xs text-ink-3">
            {slow ? "Taking a little longer than usual — hang tight." : `This takes ${estimate}.`} {note}
          </div>
        </div>
        {/* The ticking timer stays out of the live region so screen readers aren't interrupted every second. */}
        <span className="self-start rounded-md bg-surface/70 px-1.5 py-0.5 font-mono text-xs text-ink-2 tabular-nums dark:bg-surface-2/70" aria-hidden>
          {formatDuration(elapsed)}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden bg-gold-400/10" aria-hidden>
        <div className="studio-indeterminate h-full w-1/3 rounded-full bg-gold-400/70" />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── states

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center", className)}>
      <span className="grid size-14 place-items-center rounded-full bg-gold-400/12 text-gold-600 dark:text-gold-300" aria-hidden>
        <Icon className="size-6" />
      </span>
      <h3 className="mt-4 font-display text-lg font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  destructive,
  pending,
  icon: Icon,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  pending?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-6 font-display text-xl leading-snug">{title}</DialogTitle>
          <DialogDescription className="text-[15px] leading-relaxed text-ink-2 sm:text-sm">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="border-border">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending} className="h-10 rounded-xl px-4">
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm} disabled={pending} className="h-10 gap-2 rounded-xl px-4">
            {pending ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The end of a workspace step: a Back link, a line about what comes next and the primary "Continue to …" action.
 * On phones the primary action comes first and fills the width.
 */
export function StageFooter({ onBack, backLabel = "Back", hint, children }: { onBack?: () => void; backLabel?: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4">
      <div className="order-2 flex min-w-0 flex-col gap-2 sm:order-1 sm:flex-row sm:items-center sm:gap-3">
        {onBack && (
          <Button type="button" variant="ghost" onClick={onBack} className="h-11 shrink-0 justify-center gap-2 rounded-xl px-3 text-ink-2 hover:text-ink sm:justify-start">
            <ArrowLeft className="size-4" /> {backLabel}
          </Button>
        )}
        {hint && <p className="min-w-0 px-1 text-center text-sm leading-relaxed text-ink-3 sm:text-left">{hint}</p>}
      </div>
      {children && <div className="order-1 flex flex-col gap-2 sm:order-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">{children}</div>}
    </div>
  );
}

export function Notice({ icon: Icon = Info, children, tone = "info", className }: { icon?: LucideIcon; children: ReactNode; tone?: "info" | "warn"; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-sm leading-relaxed", tone === "warn" ? "bg-[var(--warn-soft)] text-warn" : "bg-surface-2 text-ink-2", className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-surface-2", className)} aria-hidden />;
}

/** Link styled as a Button (react-router navigation keeps the SPA fast). */
export function LinkButton({
  to,
  state,
  variant = "default",
  className,
  children,
  ...rest
}: { to: string; state?: unknown; variant?: "default" | "outline" | "ghost" | "secondary"; className?: string; children: ReactNode } & Omit<
  ComponentProps<typeof Link>,
  "to" | "className" | "children"
>) {
  return (
    <Link to={to} state={state} className={cn(buttonVariants({ variant }), "no-underline hover:no-underline", className)} {...rest}>
      {children}
    </Link>
  );
}

/** Accounts mode only (other devices on the network). Never rendered in personal mode. */
export function SignInCard({ from, title = "Sign in to open Sermon Studio", children }: { from: string; title?: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-xs sm:p-8">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">{title}</h2>
      <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-2">
        {children ?? "Your sermons are private to your account. Sign in to collect notes, polish a sermon with AI, design slides and publish a share page."}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <LinkButton to="/login" state={{ from }} className="h-10 gap-2 rounded-xl px-4 text-[15px]">
          <LogIn className="size-4" /> Sign in
        </LinkButton>
        <LinkButton to="/signup" state={{ from }} variant="outline" className="h-10 gap-2 rounded-xl px-4 text-[15px]">
          <UserPlus className="size-4" /> Create an account
        </LinkButton>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── misc helpers

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
}

export function fileSafe(name: string): string {
  return (
    (name || "sermon")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "sermon"
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function countWords(text: string | null | undefined): number {
  const t = (text ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
}

export function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: unknown | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}
