import { ArrowLeft, Check, CircleHelp, Inbox, type LucideIcon } from "lucide-react";
import { useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/* Shared page building blocks: consistent containers, headers, section titles, empty states and filters. */

type ButtonTone = "primary" | "secondary" | "ghost" | "gold" | "onDark";

/** Classes for links (or plain buttons) that should look like buttons. */
export function buttonClass(tone: ButtonTone = "primary", size: "sm" | "md" | "lg" = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap no-underline transition outline-none select-none hover:no-underline focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:shrink-0",
    size === "sm" && "h-8 px-3 text-[13px] [&_svg]:size-3.5",
    size === "md" && "h-10 px-4 text-sm [&_svg]:size-4",
    size === "lg" && "h-11 px-5 text-[15px] [&_svg]:size-[18px]",
    tone === "primary" && "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground",
    tone === "secondary" && "border border-border bg-card text-ink shadow-xs hover:border-line-2 hover:bg-surface-2 hover:text-ink dark:bg-white/[0.04] dark:hover:bg-white/[0.08]",
    tone === "ghost" && "text-ink-2 hover:bg-surface-2 hover:text-ink dark:hover:bg-white/[0.06]",
    tone === "gold" && "bg-gold-400 text-navy-900 shadow-sm hover:bg-gold-300 hover:text-navy-900",
    tone === "onDark" && "border border-white/20 bg-white/[0.06] text-white hover:bg-white/[0.12] hover:text-white focus-visible:ring-gold-300/50",
    className,
  );
}

export function PageContainer({ size = "default", className, ...props }: { size?: "narrow" | "default" | "wide" | "full" } & ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:px-8",
        size === "narrow" && "max-w-3xl",
        size === "default" && "max-w-6xl",
        size === "wide" && "max-w-7xl",
        className,
      )}
      {...props}
    />
  );
}

export function Eyebrow({ icon: Icon, children, className }: { icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-gold-500/25 bg-gold-50 px-2.5 py-1 text-xs font-semibold tracking-wide text-gold-700 dark:border-gold-400/20 dark:bg-gold-400/10 dark:text-gold-300",
        className,
      )}
    >
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow, icon, title, description, actions, back, className, children,
}: {
  eyebrow?: ReactNode;
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 sm:mb-8 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0 max-w-3xl">
        {back && (
          <Link to={back.to} className="mb-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-ink-3 no-underline transition hover:text-ink hover:no-underline">
            <ArrowLeft className="size-4" aria-hidden /> {back.label}
          </Link>
        )}
        {eyebrow && (
          <div className="mb-3">
            <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
          </div>
        )}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-balance text-ink sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px]/relaxed text-ink-2">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionHeading({
  icon: Icon, title, description, action, className, id,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight text-ink">
          {Icon && <Icon className="size-[18px] shrink-0 text-gold-600 dark:text-gold-400" aria-hidden />}
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox, title, description, action, className, compact,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2/80 bg-card/60 text-center",
        compact ? "px-4 py-7" : "px-6 py-12",
        className,
      )}
    >
      <span className={cn("grid grid-cols-1 place-items-center rounded-full bg-surface-2 text-ink-3 ring-8 ring-surface-2/40", compact ? "size-10" : "size-12")}>
        <Icon className={compact ? "size-[18px]" : "size-5"} aria-hidden />
      </span>
      <h3 className={cn("font-display font-semibold text-ink", compact ? "mt-3 text-base" : "mt-4 text-lg")}>{title}</h3>
      {description && <div className="mt-1 max-w-sm text-sm/relaxed text-ink-2">{description}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-surface-2", className)} {...props} />;
}

/** A toggle chip for filters. `solid` fills the active chip; `soft` tints it (for "all on by default" groups). */
export function FilterChip({
  active, count, dot, icon: Icon, variant = "solid", className, children, ...props
}: {
  active?: boolean;
  count?: number | null;
  dot?: string;
  icon?: LucideIcon;
  variant?: "solid" | "soft";
} & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-pressed={!!active}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45",
        active
          ? variant === "solid"
            ? "border-navy-700 bg-navy-700 text-white shadow-sm dark:border-gold-400 dark:bg-gold-400 dark:text-navy-900"
            : "border-navy-600/30 bg-navy-700/[0.06] text-navy-800 dark:border-gold-400/35 dark:bg-gold-400/10 dark:text-gold-100"
          : "border-border bg-card text-ink-2 hover:border-line-2 hover:bg-surface-2 hover:text-ink",
        className,
      )}
      {...props}
    >
      {dot && <span className="size-2.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden />}
      {Icon && !dot && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {children}
      {count != null && (
        <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", active && variant === "solid" ? "bg-white/20 dark:bg-navy-900/15" : "bg-surface-2 text-ink-3")}>{count}</span>
      )}
      {active && variant === "soft" && <Check className="-mr-0.5 size-3.5 shrink-0 opacity-70" aria-hidden />}
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
  title?: string;
}

/** Radio-style segmented control with arrow-key support. */
export function SegmentedControl<T extends string>({
  value, onChange, options, ariaLabel, size = "md", className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex max-w-full items-center gap-0.5 rounded-xl border border-border bg-surface-2/70 p-0.5 dark:bg-white/[0.04]", className)}>
      {options.map((o, i) => {
        const selected = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[10px] font-medium whitespace-nowrap transition outline-none focus-visible:ring-3 focus-visible:ring-ring",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
              selected ? "bg-card text-ink shadow-sm ring-1 ring-border dark:bg-white/10 dark:ring-white/10" : "text-ink-3 hover:text-ink",
            )}
          >
            {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small "?" button that explains a term in plain language (tap-friendly, unlike a hover tooltip). */
export function HelpTip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`About ${label}`}
        // 24 px visual size with a 40 px touch target
        className={cn("relative inline-grid size-6 shrink-0 place-items-center rounded-full text-ink-3 transition outline-none after:absolute after:-inset-2 after:content-[''] hover:bg-surface-2 hover:text-ink focus-visible:ring-3 focus-visible:ring-ring", className)}
      >
        <CircleHelp className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-72 text-[13px]/relaxed text-ink-2">
        <div className="mb-1 font-semibold text-ink">{label}</div>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("kbd-hint", className)}>{children}</kbd>;
}
