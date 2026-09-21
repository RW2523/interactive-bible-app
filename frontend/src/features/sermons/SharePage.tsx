import { ArrowRight, BookOpen, CalendarDays, Church, Clock, Hash, Link2, Moon, Printer, Share2, Sun, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { BrandMark } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useTheme } from "@/hooks/useTheme";
import { cn, initials } from "@/lib/utils";
import { describeError, useSharedSermon } from "./api";
import { LinkButton, Skeleton, copyToClipboard } from "./components/StudioUI";
import { sanitizeHtml } from "./lib/sanitize";
import { normalizeStructured, structuredToHtml } from "./lib/sermon/structured";
import { languageCode } from "./lib/sermon/templates";
import "./sermon-studio.css";
import type { SharedSermon } from "./types";

const STARFIELD = {
  backgroundImage:
    "radial-gradient(circle at 14% 22%, rgba(255,255,255,0.35) 1px, transparent 1.6px), radial-gradient(circle at 70% 64%, rgba(255,255,255,0.22) 1px, transparent 1.6px)",
  backgroundSize: "34px 34px, 56px 56px",
};

export default function SharePage() {
  const { slug = "" } = useParams();
  const query = useSharedSermon(slug);
  const data = query.data;

  useEffect(() => {
    if (!data?.title) return;
    // Runs after the app's generic title effect for this route.
    const t = window.setTimeout(() => {
      document.title = `${data.title} · Interactive Bible App`;
    }, 0);
    return () => window.clearTimeout(t);
  }, [data?.title]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#sermon"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to sermon
      </a>
      <ShareHeader />
      <main id="sermon" className="flex-1">
        {query.isLoading ? <ShareSkeleton /> : data ? <SharedSermonView data={data} /> : <ShareUnavailable error={query.error} onRetry={() => void query.refetch()} />}
      </main>
      <footer className="border-t border-border print:hidden">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 px-4 py-8 text-center text-sm text-ink-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-medium text-ink-2 no-underline hover:text-ink hover:no-underline">
            <BrandMark className="size-6 rounded-md [&_svg]:size-3.5" /> Created with Interactive Bible App
          </Link>
          <p className="text-xs">Read Scripture with context, explore the Bible world and prepare sermons.</p>
        </div>
      </footer>
    </div>
  );
}

function ShareHeader() {
  const [theme, toggle] = useTheme();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-paper/85 backdrop-blur-xl print:hidden">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-2.5 no-underline hover:no-underline" aria-label="Interactive Bible App home">
          <BrandMark className="size-8 rounded-lg" />
          <span className="truncate font-display text-[16px] font-semibold tracking-tight text-ink">Interactive Bible App</span>
        </Link>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
          className="size-10 rounded-xl text-ink-2 hover:text-ink"
        >
          {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </Button>
        <LinkButton to="/read" variant="outline" className="hidden h-9 gap-1.5 rounded-xl px-3 sm:inline-flex">
          <BookOpen className="size-4" /> Read the Bible
        </LinkButton>
      </div>
    </header>
  );
}

function readingMinutes(html: string): number {
  const words = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function SharedSermonView({ data }: { data: SharedSermon }) {
  const [preview, setPreviewState] = useState<{ url: string; caption: string | null } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const setPreview = (item: { url: string; caption: string | null }) => {
    setPreviewState(item);
    setPreviewOpen(true);
  };
  const html = useMemo(() => {
    const raw = data.html?.trim() ? data.html : data.structured ? structuredToHtml(normalizeStructured(data.structured, data.title)) : "";
    return sanitizeHtml(raw);
  }, [data.html, data.structured, data.title]);
  const minutes = useMemo(() => (html ? readingMinutes(html) : 0), [html]);

  const images = (data.media ?? []).filter((m): m is { url: string; caption: string | null; kind: string } => !!m.url);
  const [hero, ...gallery] = images;
  const hashtags = (data.hashtags ?? []).map((h) => h.replace(/^#/, "").trim()).filter(Boolean);
  const author = data.author?.display_name?.trim() || null;
  const church = data.author?.church?.trim() || null;
  const date = data.published_at ? new Date(data.published_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : null;
  const lang = languageCode(data.language);
  const pageUrl = typeof window !== "undefined" ? window.location.href : "";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copyLink = async () => {
    try {
      await copyToClipboard(pageUrl);
      toast.success("Link copied", { description: "Paste it into a message or email to share this sermon." });
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  return (
    <article lang={lang}>
      <section className="hero-sky relative overflow-hidden text-white">
        <div className="absolute inset-0 opacity-30" style={STARFIELD} aria-hidden />
        <div className="absolute -top-24 right-[-6rem] size-80 rounded-full bg-gold-400/15 blur-3xl" aria-hidden />
        <div className="relative mx-auto w-full max-w-3xl animate-fade-up motion-reduce:animate-none px-5 pt-10 pb-20 text-center sm:px-6 sm:pt-16 sm:pb-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] font-medium text-gold-200 backdrop-blur">
            <BookOpen className="size-3.5" aria-hidden /> Sermon
          </div>
          <h1 className="mt-5 font-display text-[2rem] leading-[1.12] font-semibold tracking-tight text-balance sm:text-5xl">{data.title}</h1>
          {data.scripture_ref && <p className="mt-4 font-serif text-lg text-gold-200 italic sm:text-xl">{data.scripture_ref}</p>}
          {data.theme && <p className="mx-auto mt-2 max-w-xl text-[15px] leading-relaxed text-white/75 sm:text-[16px]">{data.theme}</p>}
          {(author || church || date || minutes > 0) && (
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-sm text-white/75">
              {author && (
                <span className="inline-flex items-center gap-2.5">
                  <span className="grid size-9 place-items-center rounded-full bg-gold-400 text-xs font-semibold text-navy-900" aria-hidden>
                    {initials(author)}
                  </span>
                  <span className="text-left leading-tight">
                    <span className="block font-medium text-white">{author}</span>
                    {church && <span className="block text-xs text-white/65">{church}</span>}
                  </span>
                </span>
              )}
              {!author && church && (
                <span className="inline-flex items-center gap-1.5">
                  <Church className="size-4 text-gold-300" aria-hidden /> {church}
                </span>
              )}
              {date && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-4 text-gold-300" aria-hidden /> <time dateTime={data.published_at ?? undefined}>{date}</time>
                </span>
              )}
              {minutes > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-4 text-gold-300" aria-hidden /> {minutes} min read
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="relative mx-auto w-full max-w-3xl px-4 pb-12 sm:px-6">
        {data.summary && (
          <section aria-label="Summary" className="-mt-10 rounded-2xl border border-border bg-card p-5 shadow-md sm:p-7">
            <p className="text-xs font-semibold tracking-[0.14em] text-gold-700 uppercase dark:text-gold-300">In brief</p>
            <p className="mt-2 font-serif text-[17px] leading-relaxed text-ink sm:text-[18px]">{data.summary}</p>
          </section>
        )}

        {hero && (
          <figure className={cn("overflow-hidden rounded-2xl border border-border bg-card shadow-xs", data.summary ? "mt-8" : "-mt-10")}>
            <button type="button" onClick={() => setPreview(hero)} className="block w-full cursor-zoom-in" aria-label="View image larger">
              <img src={hero.url} alt={hero.caption || data.title} loading="eager" decoding="async" className="aspect-video w-full object-cover" />
            </button>
            {hero.caption && <figcaption className="px-4 py-3 text-center font-serif text-sm text-ink-2 italic">{hero.caption}</figcaption>}
          </figure>
        )}

        {html ? (
          <div
            className={cn(
              "sermon-prose prose-sermon mx-auto max-w-[68ch]",
              data.summary || hero ? "mt-10 sm:mt-12" : "mt-8 rounded-2xl border border-border bg-card p-5 shadow-md sm:p-8",
            )}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <p className="mt-10 text-center text-ink-3">This sermon doesn't have any published text yet.</p>
        )}

        {gallery.length > 0 && (
          <section aria-labelledby="share-visuals" className="mt-12">
            <h2 id="share-visuals" className="mb-4 text-xs font-semibold tracking-[0.14em] text-ink-3 uppercase">
              Visuals
            </h2>
            <div className={cn("grid grid-cols-1 gap-4", gallery.length > 1 && "sm:grid-cols-2")}>
              {gallery.map((m, i) => (
                <figure key={`${m.url}-${i}`} className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
                  <button type="button" onClick={() => setPreview(m)} className="block w-full cursor-zoom-in overflow-hidden" aria-label="View image larger">
                    <img
                      src={m.url}
                      alt={m.caption || `Visual ${i + 2} for ${data.title}`}
                      loading="lazy"
                      decoding="async"
                      className="aspect-video w-full object-cover transition duration-500 hover:scale-[1.02] motion-reduce:transition-none"
                    />
                  </button>
                  {m.caption && <figcaption className="px-3.5 py-2.5 font-serif text-sm text-ink-2 italic">{m.caption}</figcaption>}
                </figure>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="share-message" className="mt-12 rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6 print:hidden">
          <h2 id="share-message" className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-ink-3 uppercase">
            <Share2 className="size-3.5" aria-hidden /> Share this message
          </h2>
          {data.social_caption && <p className="mt-3 text-[16px] leading-relaxed whitespace-pre-line text-ink">{data.social_caption}</p>}
          {hashtags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {hashtags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-0.5 rounded-full bg-[var(--gold-soft)] px-2.5 py-1 text-[13px] font-medium text-gold-700 dark:text-gold-300">
                  <Hash className="size-3" aria-hidden />
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="mt-5 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            {canShare && (
              <Button
                onClick={() => void navigator.share({ title: data.title, text: data.social_caption ?? data.summary ?? data.title, url: pageUrl }).catch(() => undefined)}
                className="h-11 gap-2 rounded-xl px-4 sm:h-10"
              >
                <Share2 className="size-4" /> Share
              </Button>
            )}
            <Button variant={canShare ? "outline" : "default"} onClick={() => void copyLink()} className="h-11 gap-2 rounded-xl px-4 sm:h-10">
              <Link2 className="size-4" /> Copy link
            </Button>
            <Button variant="ghost" onClick={() => window.print()} className="h-11 gap-2 rounded-xl px-4 text-ink-2 sm:h-10">
              <Printer className="size-4" /> Print
            </Button>
          </div>
        </section>

        <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl bg-surface-2/60 px-5 py-8 text-center sm:px-6 print:hidden">
          <p className="font-display text-xl font-semibold text-ink">Go deeper in the Word</p>
          <p className="max-w-md text-sm leading-relaxed text-ink-2">Read the passages from this message with verse-by-verse context, or prepare a sermon of your own.</p>
          <div className="mt-1 grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-center">
            <LinkButton to="/read" className="h-11 gap-2 rounded-xl px-4 sm:h-10">
              <BookOpen className="size-4" /> Read the Bible
            </LinkButton>
            <LinkButton to="/sermons" variant="outline" className="h-11 gap-2 rounded-xl px-4 sm:h-10">
              Sermon Studio <ArrowRight className="size-4" />
            </LinkButton>
          </div>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="gap-3 p-3 sm:max-w-4xl">
          {preview && (
            <>
              <DialogTitle className="sr-only">{preview.caption || data.title}</DialogTitle>
              <img src={preview.url} alt={preview.caption || data.title} className="max-h-[78vh] w-full rounded-lg bg-navy-950 object-contain" />
              {preview.caption && <DialogDescription className="px-1 text-center font-serif italic">{preview.caption}</DialogDescription>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </article>
  );
}

function ShareSkeleton() {
  return (
    <div aria-busy="true">
      <div className="hero-sky">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 pt-14 pb-24 sm:px-6">
          <span className="h-6 w-28 animate-pulse rounded-full bg-white/10" />
          <span className="h-11 w-4/5 animate-pulse rounded-xl bg-white/10" />
          <span className="h-6 w-40 animate-pulse rounded-lg bg-white/10" />
        </div>
      </div>
      <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4 px-4 pb-12 sm:px-6">
        <Skeleton className="-mt-10 h-32 rounded-2xl" />
        <Skeleton className="mt-4 h-5 w-2/3 rounded-md" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-11/12 rounded-md" />
        <Skeleton className="h-4 w-10/12 rounded-md" />
      </div>
      <span className="sr-only" role="status">
        Loading sermon…
      </span>
    </div>
  );
}

function ShareUnavailable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);
  const { title, description } = describeError(error, "Couldn't load this sermon");
  return (
    <div className="mx-auto grid w-full max-w-lg place-items-center gap-3 px-6 py-24 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-gold-400/12 text-gold-600 dark:text-gold-300" aria-hidden>
        {notFound ? <BookOpen className="size-6" /> : <TriangleAlert className="size-6" />}
      </span>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{notFound ? "This sermon isn't available" : title}</h1>
      <p className="text-ink-2">{notFound ? "The link may be old, or the sermon is no longer shared." : (description ?? "Please try again in a moment.")}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {!notFound && (
          <Button onClick={onRetry} className="h-10 rounded-xl px-4">
            Try again
          </Button>
        )}
        <LinkButton to="/" variant={notFound ? "default" : "outline"} className="h-10 rounded-xl px-4">
          Go to Interactive Bible App
        </LinkButton>
      </div>
    </div>
  );
}
