import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, CircleCheck, Clapperboard, Combine, Flag, History, Keyboard, Loader2, Minus, Pencil, Play, Plus, Quote,
  ScanSearch, Sparkles, Star, Tags, ThumbsDown, ThumbsUp, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useBooks, useClip, useEntities, useInvalidate, useMappingDetail, useReviewQueue, useTopics } from "@/api/hooks";
import type { Json } from "@/api/types";
import { MediaPlayer, Transcript, type PlayerHandle } from "@/components/MediaPlayer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { readHref } from "@/utils/format";
import {
  ADMIN_PAGE_WIDE, ChangeTable, ChoiceCards, ConfidenceMeter, ConfirmDialog, errorMessage, ErrorCard, Field, Kbd, NativeSelect, Notice, PageHeader, RelationshipChip, SectionCard,
  shortcutBlocked, Skeleton, StatusPill, TextArea, TextInput, TimeAgo,
} from "./AdminUI";
import {
  AUDIT_ACTIONS, clock, confidenceBand, DETECTORS, duration, FEEDBACK_KINDS, FEEDBACK_STATUS, humanize, prettyRef, reasonLabel, REL_TYPES, RELATIONSHIPS, relLabel, REVIEW_STATUS,
  reviewStatusLabel, segmentLocation, sortReasons,
} from "./adminLabels";

const SKIP_CONFIRM_KEY = "ibible_review_skip_confirm";

function readSkip(): boolean {
  try {
    return sessionStorage.getItem(SKIP_CONFIRM_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSkip(v: boolean) {
  try {
    if (v) sessionStorage.setItem(SKIP_CONFIRM_KEY, "1");
    else sessionStorage.removeItem(SKIP_CONFIRM_KEY);
  } catch {
    /* ignore */
  }
}

type Decision = "approve" | "reject";

export function MappingReviewPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const state = (location.state as { queue?: string[]; from?: string } | null) ?? null;
  const q = useMappingDetail(id);
  const fallbackQueue = useReviewQueue({ status: "open", page_size: 100 }, !state?.queue);
  const books = useBooks();
  const bookNames = useMemo(() => Object.fromEntries((books.data || []).map((b) => [b.code, b.name])), [books.data]);

  const d = q.data;
  const media = d?.resource?.type === "video" || d?.resource?.type === "audio";
  const clip = useClip(d?.segment?.id && media ? d.segment.id : null);
  const player = useRef<PlayerHandle>(null);
  const [now, setNow] = useState<number | undefined>();
  const [note, setNote] = useState("");
  const [translation, setTranslation] = useState("web");
  const [confirm, setConfirm] = useState<Decision | "primary" | null>(null);
  const [dontAsk, setDontAsk] = useState(readSkip);
  const [busyAction, setBusyAction] = useState<Decision | "primary" | null>(null);
  const busy = busyAction !== null;
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setNote("");
    setConfirm(null);
    setEditing(false);
  }, [id]);

  const queue: string[] = state?.queue ?? (fallbackQueue.data?.items || []).map((x: Json) => x.mapping_id);
  const index = queue.indexOf(id);
  const prevId = index > 0 ? queue[index - 1] : null;
  const nextId = index >= 0 && index < queue.length - 1 ? queue[index + 1] : null;
  const backTo = state?.from && state.from.startsWith("/admin") ? state.from : "/admin/review";
  const backLabel = backTo === "/admin" ? "Dashboard" : "Review queue";

  const goTo = useCallback(
    (target: string | null) => {
      if (target) navigate(`/admin/review/${target}`, { state: { queue, from: backTo }, replace: true });
    },
    [navigate, queue, backTo],
  );

  const afterDecision = () => {
    const remaining = queue.filter((x) => x !== id);
    const nextTarget = nextId ?? (index > 0 ? queue[index - 1] : remaining[0]) ?? null;
    if (nextTarget && nextTarget !== id) {
      navigate(`/admin/review/${nextTarget}`, { state: { queue: remaining, from: backTo }, replace: true });
    } else {
      toast.success("That was the last one — you're all caught up");
      navigate(backTo);
    }
  };

  const decide = async (kind: Decision) => {
    if (!d) return;
    setBusyAction(kind);
    try {
      if (kind === "approve") await api(`/v1/admin/mappings/${id}/approve`, { method: "POST", body: { note: note.trim() || null } });
      else await api(`/v1/admin/mappings/${id}${note.trim() ? `?note=${encodeURIComponent(note.trim())}` : ""}`, { method: "DELETE" });
      toast.success(kind === "approve" ? `Approved ${d.mapping.verse_display}` : `Rejected ${d.mapping.verse_display}`, {
        description: kind === "approve" ? "Readers can now see this link." : "It stays hidden from readers.",
      });
      invalidate("mapping", "review-queue", "intel", "segments", "clip", "admin-metrics", "audit");
      writeSkip(dontAsk);
      setConfirm(null);
      afterDecision();
    } catch (e) {
      toast.error("That didn't work", { description: errorMessage(e) });
    } finally {
      setBusyAction(null);
    }
  };

  const request = (kind: Decision) => {
    if (busy || !d) return;
    if (readSkip()) void decide(kind);
    else setConfirm(kind);
  };

  const setPrimary = async () => {
    if (!d) return;
    setBusyAction("primary");
    try {
      await api(`/v1/admin/segments/${d.segment.id}/primary`, { method: "POST", body: { mapping_id: id, note: note.trim() || null } });
      toast.success(`${d.mapping.verse_display} is now the main verse for this section`);
      invalidate("mapping", "review-queue", "intel", "segments", "clip");
      setConfirm(null);
    } catch (e) {
      toast.error("That didn't work", { description: errorMessage(e) });
    } finally {
      setBusyAction(null);
    }
  };

  // keyboard shortcuts: A approve · R reject · E edit · J/→ next · K/← previous
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutBlocked(e) || !d || busy || editing || confirm) return;
      const key = e.key.toLowerCase();
      if (key === "a") {
        e.preventDefault();
        request("approve");
      } else if (key === "r") {
        e.preventDefault();
        request("reject");
      } else if (key === "e") {
        e.preventDefault();
        setEditing(true);
      } else if ((key === "j" || e.key === "ArrowRight") && nextId) {
        e.preventDefault();
        goTo(nextId);
      } else if ((key === "k" || e.key === "ArrowLeft") && prevId) {
        e.preventDefault();
        goTo(prevId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (q.error) {
    return (
      <div className={ADMIN_PAGE_WIDE}>
        <PageHeader back={{ to: backTo, label: backLabel }} title="Verse link" />
        <ErrorCard error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      </div>
    );
  }
  if (!d) return <ReviewSkeleton back={backTo} backLabel={backLabel} />;

  const m = d.mapping;
  const seg = d.segment;
  const r = d.resource;
  const conf = m.confidence_override ?? m.confidence;
  const status = REVIEW_STATUS[m.review_status];
  const decided = m.review_status === "approved" || m.review_status === "rejected";
  const verseEntries = Object.entries((d.verse_texts || {}) as Record<string, Record<string, string>>);
  const reasons = sortReasons(m.review_reasons);

  return (
    <div className={cn(ADMIN_PAGE_WIDE, "@container pb-0 sm:pb-0 @3xl:pb-8")}>
      <PageHeader
        back={{ to: backTo, label: backLabel }}
        icon={ScanSearch}
        eyebrow={index >= 0 ? `Review · item ${index + 1} of ${queue.length}` : "Review"}
        title={m.verse_display}
        description={
          <>
            in <span className="font-medium text-ink">{r.title}</span>
            {segmentLocation(seg) && ` · ${segmentLocation(seg)}`}
            {r.speaker ? ` · ${r.speaker}` : r.author ? ` · ${r.author}` : ""}
          </>
        }
        actions={
          queue.length > 1 && index >= 0 ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" disabled={!prevId} onClick={() => goTo(prevId)} className="h-10 gap-1.5 rounded-xl bg-card px-3" aria-label="Previous item (K)">
                <ChevronLeft className="size-4" aria-hidden /> Previous
              </Button>
              <Button variant="outline" disabled={!nextId} onClick={() => goTo(nextId)} className="h-10 gap-1.5 rounded-xl bg-card px-3" aria-label="Next item (J)">
                Next <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="mt-3 flex flex-wrap gap-2">
          <RelationshipChip type={m.relationship_type} />
          <StatusPill tone={status?.tone ?? "neutral"} icon={m.is_human_verified ? CircleCheck : undefined}>
            {reviewStatusLabel(m.review_status)}
            {m.is_human_verified && !decided ? " · checked by a person" : ""}
          </StatusPill>
          {m.primary_flag && (
            <StatusPill tone="brand" icon={Star}>
              Main verse of this section
            </StatusPill>
          )}
          {m.feedback_count > 0 && (
            <StatusPill tone="danger" icon={Flag}>
              {m.feedback_count} reader {m.feedback_count === 1 ? "report" : "reports"}
            </StatusPill>
          )}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_360px] @6xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* decision first in reading order; shown on the right on wide screens */}
        <div className="grid grid-cols-1 gap-4 top-[calc(var(--header-h)+5rem)] @3xl:sticky @3xl:col-start-2 @3xl:row-start-1 xl:top-[calc(var(--header-h)+1.5rem)]">
          <section
            aria-labelledby="decision-title"
            className="rounded-2xl border border-gold-500/40 bg-card shadow-sm @3xl:flex @3xl:max-h-[calc(100dvh-var(--header-h)-6.5rem)] @3xl:flex-col @3xl:xl:max-h-[calc(100dvh-var(--header-h)-3rem)] dark:border-gold-400/30"
          >
            <div className="shrink-0 border-b border-border px-4 py-4 sm:px-5">
              <h2 id="decision-title" className="font-display text-xl leading-snug font-semibold text-ink">
                Is {m.verse_display} a good match for this section?
              </h2>
              {decided && (
                <p className="mt-1.5 text-sm text-ink-2">
                  Already {m.review_status === "approved" ? "approved" : "rejected"}. You can still change your mind.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:px-5 @3xl:min-h-0 @3xl:flex-1 @3xl:overflow-y-auto">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold tracking-wider text-ink-2 uppercase">The verse</h3>
                  <div role="group" aria-label="Translation" className="inline-flex rounded-lg border border-border bg-surface-2/60 p-0.5">
                    {["web", "kjv", "asv"].map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={translation === t}
                        onClick={() => setTranslation(t)}
                        className={cn("h-8 rounded-md px-2.5 text-xs font-semibold transition", translation === t ? "bg-card text-ink shadow-xs" : "text-ink-2 hover:text-ink")}
                      >
                        {t.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 rounded-xl bg-surface-2/50 p-3.5">
                  {verseEntries.length === 0 && <p className="text-sm text-ink-2">Verse text isn't available.</p>}
                  {verseEntries.map(([ref, texts]) => (
                    <p key={ref} className="font-serif text-[17px] leading-relaxed text-ink">
                      {verseEntries.length > 1 && <sup className="mr-1 font-sans text-[11px] font-bold text-gold-700 dark:text-gold-300">{ref.split(".").pop()}</sup>}
                      {texts[translation] || Object.values(texts)[0]}
                    </p>
                  ))}
                  <Link to={readHref(m.verse_ref)} className="inline-flex min-h-8 w-fit items-center gap-1.5 text-sm font-semibold text-link no-underline hover:underline">
                    <BookOpen className="size-4" aria-hidden /> Read in context
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 text-sm">
                <div>
                  <h3 className="text-xs font-semibold tracking-wider text-ink-2 uppercase">How it's used</h3>
                  <p className="mt-1 text-ink">
                    <span className="font-semibold">{relLabel(m.relationship_type)}</span> — {RELATIONSHIPS[m.relationship_type]?.description}
                    {m.relationship_subtype && <span className="text-ink-2"> ({humanize(m.relationship_subtype).toLowerCase()})</span>}
                  </p>
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-semibold tracking-wider text-ink-2 uppercase">Confidence</h3>
                  <ConfidenceMeter value={conf} showMeaning width="w-32" />
                  {m.confidence_override != null && <p className="mt-1 text-xs text-ink-2">Set by a person (the system said {Math.round(m.confidence * 100)}%).</p>}
                </div>
                {m.why_related && (
                  <div>
                    <h3 className="text-xs font-semibold tracking-wider text-ink-2 uppercase">Why it was linked</h3>
                    <p className="mt-1 leading-relaxed text-ink">{m.why_related}</p>
                  </div>
                )}
                {m.audit?.decision && (
                  <div className="rounded-xl border border-border bg-surface-2/40 p-3">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-ink-2 uppercase">
                      <Sparkles className="size-3.5" aria-hidden /> AI double-check
                    </h3>
                    <p className="mt-1 leading-relaxed text-ink">
                      <span className="font-semibold">{m.audit.decision === "keep" || m.audit.decision === "approve" ? "Looks right" : m.audit.decision === "reject" ? "Probably wrong" : "Not sure"}</span>
                      {m.audit.reason ? ` — ${m.audit.reason}` : ""}
                    </p>
                  </div>
                )}
                {reasons.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold tracking-wider text-ink-2 uppercase">Why it's in the queue</h3>
                    <ul className="mt-1 grid grid-cols-1 gap-1">
                      {reasons.map((code) => (
                        <li key={code} className="flex items-start gap-2 text-ink">
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-gold-500" aria-hidden /> {reasonLabel(code)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="grid shrink-0 grid-cols-1 gap-3 rounded-b-2xl border-t border-border bg-surface-2/30 px-4 py-4 sm:px-5">
              <Field label="Note for the history" htmlFor="review-note" optional>
                <TextInput id="review-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Speaker quotes this verse at 0:45" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => request("approve")} disabled={busy} className="h-11 gap-2 rounded-xl bg-[#1b5e20] text-[15px] text-white hover:bg-[#1b5e20]/90 dark:bg-ok dark:text-navy-950 dark:hover:bg-ok/90">
                  {busyAction === "approve" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ThumbsUp className="size-4" aria-hidden />} Approve
                  <Kbd className="ml-1 hidden border-white/30 bg-white/10 text-current sm:inline-flex dark:border-navy-950/20 dark:bg-navy-950/10">A</Kbd>
                </Button>
                <Button variant="outline" onClick={() => request("reject")} disabled={busy} className="h-11 gap-2 rounded-xl border-danger/40 bg-card text-[15px] text-danger hover:bg-[var(--danger-soft)] hover:text-danger">
                  {busyAction === "reject" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ThumbsDown className="size-4" aria-hidden />} Reject <Kbd className="ml-1 hidden sm:inline-flex">R</Kbd>
                </Button>
                <Button variant="outline" onClick={() => setEditing(true)} disabled={busy} className="h-10 gap-2 rounded-xl bg-card">
                  <Pencil className="size-4" aria-hidden /> Edit <Kbd className="ml-1 hidden sm:inline-flex">E</Kbd>
                </Button>
                <Button variant="outline" onClick={() => setConfirm("primary")} disabled={busy || m.primary_flag || m.review_status === "rejected"} className="h-10 gap-2 rounded-xl bg-card">
                  {busyAction === "primary" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Star className="size-4" aria-hidden />} {m.primary_flag ? "Main verse" : "Make main verse"}
                </Button>
              </div>
              <p className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2 sm:flex">
                <Keyboard className="size-3.5" aria-hidden />
                <span>
                  <Kbd>J</Kbd> next
                </span>
                <span>
                  <Kbd>K</Kbd> previous
                </span>
                {dontAsk && (
                  <button
                    type="button"
                    className="min-h-8 font-semibold text-link hover:underline"
                    onClick={() => {
                      setDontAsk(false);
                      writeSkip(false);
                      toast("Confirmations are back on");
                    }}
                  >
                    Ask before deciding again
                  </button>
                )}
              </p>
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 min-w-0 gap-6 @3xl:col-start-1 @3xl:row-start-1">
          <SectionCard
            icon={Quote}
            title={media ? "What was said" : "What was written"}
            description={
              <>
                <mark className="evidence rounded px-1">Highlighted words</mark> are the evidence for this link.
                {seg.heading ? ` Section: ${seg.heading}.` : ""}
              </>
            }
          >
            {media && clip.data && (
              <div className="mb-4">
                <MediaPlayer ref={player} playback={clip.data.playback} clip={clip.data.clip} durationMs={r.duration_ms} title={r.title} onTime={setNow} />
              </div>
            )}
            {media && clip.isLoading && <Skeleton className="mb-4 aspect-video w-full rounded-xl" />}
            {d.context?.before && <p className="mb-3 font-serif text-[15px] leading-relaxed text-ink-2">…{d.context.before.text_normalized.slice(-240)}</p>}
            <div className="rounded-xl border border-border bg-surface/60 p-3 sm:p-4 dark:bg-surface-2/30">
              <Transcript text={seg.text} units={seg.units || []} highlights={m.evidence_offsets || []} nowMs={now} onSeek={media ? (ms) => player.current?.seek(ms, true) : undefined} maxHeight={420} />
            </div>
            {d.context?.after && <p className="mt-3 font-serif text-[15px] leading-relaxed text-ink-2">{d.context.after.text_normalized.slice(0, 240)}…</p>}
            {media && <p className="mt-3 text-xs text-ink-2">Tip: click any sentence to play the recording from that point.</p>}
          </SectionCard>

          {media && <ClipCard d={d} note={note} player={player} onSaved={() => invalidate("mapping", "clip")} />}
          <SectionLinks d={d} note={note} bookNames={bookNames} />
          <TagsCard d={d} note={note} />
          <HistoryCard d={d} />
          <ProvenanceCard m={m} />
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "approve" || confirm === "reject"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "approve" ? "Approve this verse link?" : "Reject this verse link?"}
        description={
          confirm === "approve" ? (
            <>
              <strong className="text-ink">{m.verse_display}</strong> will be shown to readers with “{r.title}”, marked as checked by a person.
            </>
          ) : (
            <>
              <strong className="text-ink">{m.verse_display}</strong> will be hidden from readers. Your decision is kept even if this item is processed again.
            </>
          )
        }
        confirmLabel={confirm === "approve" ? "Approve" : "Reject"}
        tone={confirm === "approve" ? "ok" : "destructive"}
        focusConfirm
        icon={confirm === "approve" ? ThumbsUp : ThumbsDown}
        pending={busy}
        onConfirm={() => confirm && confirm !== "primary" && void decide(confirm)}
      >
        {note.trim() && (
          <p className="rounded-xl bg-surface-2/60 px-3 py-2 text-sm text-ink-2">
            Note: <span className="text-ink">“{note.trim()}”</span>
          </p>
        )}
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
          Don't ask again until I close this tab
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "primary"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Make ${m.verse_display} the main verse?`}
        description="The main verse is shown first for this section — in the library, on clips and when the section is shared."
        confirmLabel="Make main verse"
        icon={Star}
        pending={busy}
        onConfirm={() => void setPrimary()}
      />

      {/* phones and tablets: decision buttons always within reach */}
      <div className="sticky bottom-[var(--bottom-nav-h)] z-30 -mx-4 mt-6 border-t border-border bg-card/95 px-4 py-2.5 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 @3xl:hidden">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{m.verse_display}</span>
          <Button onClick={() => request("approve")} disabled={busy} className="h-10 gap-1.5 rounded-xl bg-[#1b5e20] px-3.5 text-white hover:bg-[#1b5e20]/90 dark:bg-ok dark:text-navy-950">
            <ThumbsUp className="size-4" aria-hidden /> Approve
          </Button>
          <Button variant="outline" onClick={() => request("reject")} disabled={busy} className="h-10 gap-1.5 rounded-xl border-danger/40 bg-card px-3.5 text-danger hover:bg-[var(--danger-soft)] hover:text-danger">
            <ThumbsDown className="size-4" aria-hidden /> Reject
          </Button>
          <Button variant="outline" onClick={() => setEditing(true)} disabled={busy} className="h-10 w-10 shrink-0 rounded-xl bg-card p-0" aria-label="Edit verse link">
            <Pencil className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {editing && (
        <EditMappingDialog
          d={d}
          note={note}
          onClose={() => setEditing(false)}
          onSaved={() => {
            invalidate("mapping", "review-queue", "intel", "segments", "clip", "audit");
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function ReviewSkeleton({ back, backLabel }: { back: string; backLabel: string }) {
  return (
    <div className={ADMIN_PAGE_WIDE} role="status" aria-label="Loading verse link">
      <Link to={back} className="mb-4 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-ink-2 no-underline">
        <ArrowLeft className="size-4" aria-hidden /> {backLabel}
      </Link>
      <Skeleton className="mb-3 h-10 w-64" />
      <Skeleton className="mb-8 h-4 w-80" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── edit

function EditMappingDialog({ d, note, onClose, onSaved }: { d: Json; note: string; onClose: () => void; onSaved: () => void }) {
  const m = d.mapping;
  const [form, setForm] = useState({
    relationship_type: m.relationship_type as string,
    verse_ref: m.verse_display as string,
    confidence: m.confidence_override != null ? String(Math.round(m.confidence_override * 100)) : "",
    why_related: (m.why_related || "") as string,
    evidence_text: (m.evidence_text || "") as string,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confNumber = form.confidence.trim() === "" ? null : Number(form.confidence);
  const confInvalid = confNumber !== null && (!Number.isFinite(confNumber) || confNumber < 0 || confNumber > 100);

  const save = async () => {
    if (!form.verse_ref.trim()) return setError("Enter the verse or passage.");
    if (confInvalid) return setError("Confidence must be a number from 0 to 100.");
    setSaving(true);
    setError(null);
    try {
      const verseChanged = form.verse_ref.trim() !== m.verse_display && form.verse_ref.trim() !== m.verse_ref;
      await api(`/v1/admin/mappings/${m.id}`, {
        method: "PATCH",
        body: {
          relationship_type: form.relationship_type,
          verse_ref: verseChanged ? form.verse_ref.trim() : undefined,
          confidence_override: confNumber === null ? undefined : confNumber / 100,
          evidence_text: form.evidence_text,
          why_related: form.why_related.trim() || undefined,
          note: note.trim() || null,
        },
      });
      toast.success("Verse link saved and approved", { description: "It's marked as checked by a person." });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle className="font-display text-xl">Edit verse link</DialogTitle>
          <DialogDescription>Fix what the system got wrong. Saving also approves the link, so readers will see it.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-5 p-5">
          <ChoiceCards
            name="edit-relationship"
            legend="How is the verse used?"
            value={form.relationship_type}
            onChange={(v) => setForm((f) => ({ ...f, relationship_type: v }))}
            options={REL_TYPES.map((t) => ({ value: t, label: RELATIONSHIPS[t].label, description: RELATIONSHIPS[t].description }))}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
            <Field label="Verse or passage" htmlFor="edit-verse" hint="For example Romans 8:28 or Romans 8:28-30. Changing it replaces this link.">
              <TextInput id="edit-verse" value={form.verse_ref} onChange={(e) => setForm((f) => ({ ...f, verse_ref: e.target.value }))} />
            </Field>
            <Field label="Confidence %" htmlFor="edit-confidence" optional hint="Leave empty to keep the system's score.">
              <TextInput id="edit-confidence" inputMode="numeric" value={form.confidence} aria-invalid={confInvalid} onChange={(e) => setForm((f) => ({ ...f, confidence: e.target.value }))} placeholder={String(Math.round(m.confidence * 100))} />
            </Field>
          </div>
          <Field label="Why it's related" htmlFor="edit-why" optional hint="A sentence readers may see when they ask why this verse is linked.">
            <TextArea id="edit-why" value={form.why_related} onChange={(e) => setForm((f) => ({ ...f, why_related: e.target.value }))} className="min-h-20" />
          </Field>
          <Field label="Evidence" htmlFor="edit-evidence" hint="The words from the section that show the connection.">
            <TextArea id="edit-evidence" value={form.evidence_text} onChange={(e) => setForm((f) => ({ ...f, evidence_text: e.target.value }))} className="min-h-24 font-serif" />
          </Field>
          {error && (
            <Notice tone="danger" title="Couldn't save">
              {error}
            </Notice>
          )}
        </div>
        <DialogFooter className="sticky bottom-0 m-0 rounded-none border-t border-border bg-card p-4">
          <Button variant="ghost" onClick={onClose} disabled={saving} className="h-10 rounded-xl px-4">
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving} className="h-10 gap-2 rounded-xl px-4">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />} Save and approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────── clip boundaries

function ClipCard({ d, note, player, onSaved }: { d: Json; note: string; player: React.RefObject<PlayerHandle | null>; onSaved: () => void }) {
  const seg = d.segment;
  const c = seg.clip || {};
  const units: Json[] = seg.units || [];
  const initialStart = Number(c.start_ms ?? seg.start_ms ?? 0);
  const initialEnd = Number(c.end_ms ?? seg.end_ms ?? 0);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [saving, setSaving] = useState<"approve" | "save" | null>(null);
  const [caption, setCaption] = useState<Json | null>(null);
  const [captionBusy, setCaptionBusy] = useState(false);

  useEffect(() => {
    setStart(initialStart);
    setEnd(initialEnd);
  }, [initialStart, initialEnd]);

  const starts = useMemo(() => [...new Set([initialStart, ...units.map((u) => u.start_ms).filter((x) => x != null)])].sort((a, b) => a - b), [units, initialStart]);
  const ends = useMemo(() => [...new Set([initialEnd, ...units.map((u) => u.end_ms).filter((x) => x != null)])].sort((a, b) => a - b), [units, initialEnd]);

  const lo = Math.min(Number(seg.start_ms ?? start), start);
  const hi = Math.max(Number(seg.end_ms ?? end), end, lo + 1);
  const pos = (ms: number) => `${((ms - lo) / (hi - lo)) * 100}%`;
  const length = end - start;
  const tooShort = length < 15_000;
  const tooLong = length > 180_000;
  const changed = start !== initialStart || end !== initialEnd;
  const evidence = ((d.mapping.evidence_offsets || []) as Json[]).filter((e) => e.start_ms != null && e.end_ms != null);

  const nudge = (list: number[], value: number, dir: -1 | 1) => {
    const i = list.indexOf(value);
    const j = Math.max(0, Math.min(list.length - 1, (i < 0 ? list.findIndex((x) => x > value) : i) + dir));
    return list[j] ?? value;
  };

  const save = async (approveOnly: boolean) => {
    setSaving(approveOnly ? "approve" : "save");
    try {
      await api(`/v1/admin/segments/${seg.id}/clip`, { method: "PATCH", body: approveOnly ? { approve_only: true, note: note.trim() || null } : { start_ms: start, end_ms: end, note: note.trim() || null } });
      toast.success(approveOnly ? "Clip approved" : "New clip start and end saved");
      onSaved();
    } catch (e) {
      toast.error("That didn't work", { description: errorMessage(e) });
    } finally {
      setSaving(null);
    }
  };

  const writeCaption = async () => {
    setCaptionBusy(true);
    try {
      setCaption(await api<Json>(`/v1/admin/clips/${seg.id}/caption`, { method: "POST" }));
    } catch (e) {
      toast.error("Couldn't write captions", { description: errorMessage(e) });
    } finally {
      setCaptionBusy(false);
    }
  };

  const clipStatus = c.review_status === "approved" ? { label: "Approved", tone: "ok" as const } : c.review_status === "edited" ? { label: "Adjusted by a person", tone: "info" as const } : { label: "Chosen automatically", tone: "neutral" as const };

  return (
    <SectionCard
      icon={Clapperboard}
      title="Clip boundaries"
      description="Readers can play this short clip from the verse page. Start and end snap to whole sentences."
      action={<StatusPill tone={clipStatus.tone}>{clipStatus.label}</StatusPill>}
    >
      {c.reason && <p className="mb-4 text-sm leading-relaxed text-ink-2">Why this clip: {c.reason}</p>}

      <div className="mb-5">
        <div className="relative h-10" aria-hidden>
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-surface-2" />
          <div className="absolute top-1/2 h-4 -translate-y-1/2 rounded-md bg-gold-400/70 dark:bg-gold-400/60" style={{ left: pos(start), width: `calc(${pos(end)} - ${pos(start)})` }} />
          {c.core_start_ms != null && c.core_end_ms != null && (
            <div className="absolute top-1/2 h-4 -translate-y-1/2 rounded-md bg-gold-600 dark:bg-gold-300" style={{ left: pos(Math.max(start, c.core_start_ms)), width: `calc(${pos(Math.min(end, c.core_end_ms))} - ${pos(Math.max(start, c.core_start_ms))})` }} />
          )}
          {evidence.map((e, i) => (
            <div key={i} className="absolute top-0 h-full w-0.5 rounded bg-navy-700 dark:bg-white" style={{ left: pos(e.start_ms) }} title="Evidence" />
          ))}
        </div>
        <div className="flex justify-between text-xs text-ink-2 tabular-nums">
          <span>{clock(lo)}</span>
          <span>{clock(hi)}</span>
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-gold-400/70" aria-hidden /> Clip
          </span>
          {c.core_start_ms != null && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm bg-gold-600 dark:bg-gold-300" aria-hidden /> Key moment
            </span>
          )}
          {evidence.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-0.5 rounded bg-navy-700 dark:bg-white" aria-hidden /> Where the verse comes up
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BoundaryControl label="Start" id="clip-start" value={start} options={starts} onChange={setStart} onNudge={(dir) => setStart(nudge(starts, start, dir))} />
        <BoundaryControl label="End" id="clip-end" value={end} options={ends} onChange={setEnd} onNudge={(dir) => setEnd(nudge(ends, end, dir))} />
      </div>

      <p className={cn("mt-3 text-sm", end <= start ? "text-danger" : tooShort || tooLong ? "text-warn" : "text-ink-2")} aria-live="polite">
        {end <= start ? "The end must come after the start." : `Length ${duration(length)}${tooShort || tooLong ? " — the best clips are between 15 seconds and 3 minutes." : " — a good length."}`}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => player.current?.seek(start, true)} className="h-10 gap-2 rounded-xl bg-card px-3.5">
          <Play className="size-4" aria-hidden /> Preview from start
        </Button>
        <Button variant="outline" onClick={() => void save(true)} disabled={!!saving || changed} className="h-10 gap-2 rounded-xl bg-card px-3.5" title={changed ? "Save or reset your changes first" : undefined}>
          {saving === "approve" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CircleCheck className="size-4" aria-hidden />} Approve clip as it is
        </Button>
        <Button onClick={() => void save(false)} disabled={!!saving || !changed || end <= start} className="h-10 gap-2 rounded-xl px-3.5">
          {saving === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />} Save new start and end
        </Button>
        {changed && (
          <Button
            variant="ghost"
            onClick={() => {
              setStart(initialStart);
              setEnd(initialEnd);
            }}
            className="h-10 rounded-xl px-3"
          >
            Reset
          </Button>
        )}
      </div>

      <details className="group mt-5 rounded-xl border border-border">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-ink">
          <span className="inline-flex items-center gap-2">
            <Sparkles className="size-4 text-gold-600 dark:text-gold-300" aria-hidden /> Social media captions for this clip
          </span>
          <ArrowRight className="size-4 text-ink-2 transition group-open:rotate-90" aria-hidden />
        </summary>
        <div className="grid grid-cols-1 gap-3 border-t border-border p-3 text-sm">
          <p className="text-ink-2">Writes a hook, caption lines and a description for sharing the clip. Uses AI (a fraction of a cent) and is never used for verse links.</p>
          <Button variant="outline" onClick={() => void writeCaption()} disabled={captionBusy} className="h-10 w-fit gap-2 rounded-xl bg-card px-3.5">
            {captionBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            {captionBusy ? "Writing…" : caption ? "Write again" : "Write captions"}
          </Button>
          {caption && (
            <dl className="grid grid-cols-1 gap-2 rounded-xl bg-surface-2/50 p-3">
              <div>
                <dt className="text-xs font-semibold text-ink-2">Hook</dt>
                <dd className="text-ink">{caption.hook}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-ink-2">Verse label</dt>
                <dd className="text-ink">{caption.verse_label}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-ink-2">Caption lines</dt>
                <dd className="text-ink">{(caption.caption_lines || []).join(" / ")}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-ink-2">Description</dt>
                <dd className="text-ink">{caption.description}</dd>
              </div>
              <dd className={cn("text-xs font-medium", caption.validation_issues?.length ? "text-danger" : "text-ok")}>
                {caption.validation_issues?.length ? `Check before posting: ${caption.validation_issues.join("; ")}` : "Quoted words match the recording."}
              </dd>
            </dl>
          )}
        </div>
      </details>
    </SectionCard>
  );
}

function BoundaryControl({ label, id, value, options, onChange, onNudge }: { label: string; id: string; value: number; options: number[]; onChange: (v: number) => void; onNudge: (dir: -1 | 1) => void }) {
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex gap-1.5">
        <Button variant="outline" onClick={() => onNudge(-1)} className="h-10 w-10 shrink-0 rounded-xl bg-card p-0" aria-label={`${label}: one sentence earlier`}>
          <Minus className="size-4" aria-hidden />
        </Button>
        <NativeSelect id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} wrapperClassName="flex-1" className="tabular-nums">
          {options.map((ms) => (
            <option key={ms} value={ms}>
              {clock(ms)}
            </option>
          ))}
        </NativeSelect>
        <Button variant="outline" onClick={() => onNudge(1)} className="h-10 w-10 shrink-0 rounded-xl bg-card p-0" aria-label={`${label}: one sentence later`}>
          <Plus className="size-4" aria-hidden />
        </Button>
      </div>
    </Field>
  );
}

// ───────────────────────────────────────────────────────────── other links in the section

function SectionLinks({ d, note, bookNames }: { d: Json; note: string; bookNames: Record<string, string> }) {
  const invalidate = useInvalidate();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [busy, setBusy] = useState<"merge" | "add" | null>(null);
  const [add, setAdd] = useState({ verse_ref: "", relationship_type: "direct_reference", evidence_text: "" });
  const [addError, setAddError] = useState<string | null>(null);
  const rows: Json[] = d.segment_mappings || [];
  const selectedLabels = rows.filter((s) => selected.includes(s.mapping_id)).map((s) => prettyRef(s.verse_ref, bookNames));

  const merge = async () => {
    setBusy("merge");
    try {
      await api(`/v1/admin/mappings/merge`, { method: "POST", body: { mapping_ids: selected, note: note.trim() || null } });
      toast.success("Merged into one passage");
      setSelected([]);
      setConfirmMerge(false);
      invalidate("mapping", "review-queue", "intel", "segments", "audit");
    } catch (e) {
      toast.error("Couldn't merge", { description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const addLink = async () => {
    if (!add.verse_ref.trim()) {
      setAddError("Enter a verse, for example Genesis 50:20.");
      return;
    }
    setBusy("add");
    setAddError(null);
    try {
      const res = await api<Json>(`/v1/admin/mappings`, { method: "POST", body: { segment_id: d.segment.id, ...add, verse_ref: add.verse_ref.trim(), note: note.trim() || null } });
      toast.success(`Added ${res.mapping?.verse_display ?? add.verse_ref}`, { description: "Added links are approved straight away." });
      setAdd({ verse_ref: "", relationship_type: "direct_reference", evidence_text: "" });
      invalidate("mapping", "review-queue", "intel", "segments", "audit");
    } catch (e) {
      setAddError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SectionCard icon={BookOpen} title="All verse links in this section" description="Tick two or more verses from the same book to merge them into one passage.">
      <ul className="grid grid-cols-1 gap-2">
        {rows.map((s) => {
          const current = s.mapping_id === d.mapping.id;
          const st = REVIEW_STATUS[s.review_status];
          return (
            <li key={s.mapping_id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-2.5", current ? "border-gold-500/50 bg-gold-400/10" : "border-border")}>
              <label className="grid size-8 cursor-pointer place-items-center">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={selected.includes(s.mapping_id)}
                  onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, s.mapping_id] : cur.filter((x) => x !== s.mapping_id)))}
                  aria-label={`Select ${prettyRef(s.verse_ref, bookNames)} to merge`}
                />
              </label>
              <div className="min-w-0 flex-1">
                {current ? (
                  <span className="font-semibold text-ink">
                    {prettyRef(s.verse_ref, bookNames)} <span className="text-xs font-normal text-ink-2">(this one)</span>
                  </span>
                ) : (
                  <Link to={`/admin/review/${s.mapping_id}`} className="font-semibold text-link">
                    {prettyRef(s.verse_ref, bookNames)}
                  </Link>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <RelationshipChip type={s.relationship_type} />
                  <span className="text-xs font-semibold text-ink tabular-nums" title={confidenceBand(Number(s.confidence)).label}>
                    {Math.round(Number(s.confidence) * 100)}%
                  </span>
                  {s.primary && <Star className="size-3.5 fill-gold-400 text-gold-500" aria-label="Main verse" />}
                </div>
              </div>
              <StatusPill tone={st?.tone ?? "neutral"} icon={s.is_human_verified ? CircleCheck : undefined}>
                {reviewStatusLabel(s.review_status)}
              </StatusPill>
            </li>
          );
        })}
      </ul>
      <Button variant="outline" disabled={selected.length < 2 || !!busy} onClick={() => setConfirmMerge(true)} className="mt-3 h-10 gap-2 rounded-xl bg-card px-3.5">
        <Combine className="size-4" aria-hidden /> Merge {selected.length >= 2 ? `${selected.length} selected` : "selected"} into one passage
      </Button>

      <div className="mt-5 border-t border-border pt-5">
        <h3 className="text-sm font-semibold text-ink">Add a verse the system missed</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
          <Field label="Verse" htmlFor="add-verse" error={addError}>
            <TextInput id="add-verse" placeholder="e.g. Genesis 50:20" value={add.verse_ref} aria-invalid={!!addError} onChange={(e) => setAdd({ ...add, verse_ref: e.target.value })} />
          </Field>
          <Field label="How it's used" htmlFor="add-rel">
            <NativeSelect id="add-rel" value={add.relationship_type} onChange={(e) => setAdd({ ...add, relationship_type: e.target.value })}>
              {REL_TYPES.map((t) => (
                <option key={t} value={t}>{relLabel(t)}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Evidence" htmlFor="add-evidence" optional hint="Copy the exact words from the section so they can be highlighted." className="sm:col-span-2">
            <TextInput id="add-evidence" value={add.evidence_text} onChange={(e) => setAdd({ ...add, evidence_text: e.target.value })} />
          </Field>
        </div>
        <Button onClick={() => void addLink()} disabled={busy === "add"} className="mt-3 h-10 gap-2 rounded-xl px-3.5">
          {busy === "add" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />} Add verse link
        </Button>
      </div>

      <ConfirmDialog
        open={confirmMerge}
        onOpenChange={setConfirmMerge}
        title={`Merge ${selected.length} verse links into one passage?`}
        description={`${selectedLabels.join(", ")} will become a single passage link, approved and marked as checked by a person.`}
        confirmLabel="Merge"
        icon={Combine}
        pending={busy === "merge"}
        onConfirm={() => void merge()}
      />
    </SectionCard>
  );
}

// ───────────────────────────────────────────────────────────── tags

function TagsCard({ d, note }: { d: Json; note: string }) {
  const topics = useTopics();
  const entities = useEntities();
  const invalidate = useInvalidate();
  const [topic, setTopic] = useState("");
  const [entity, setEntity] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const patch = async (key: string, body: Json, message: string) => {
    setBusy(key);
    try {
      await api(`/v1/admin/segments/${d.segment.id}/tags`, { method: "PATCH", body: { ...body, note: note.trim() || null } });
      toast.success(message);
      invalidate("mapping", "intel", "segments");
      return true;
    } catch (e) {
      toast.error("Couldn't update tags", { description: errorMessage(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const tagChip = (key: string, label: ReactNode, sub: string, onRemove: () => void, removeLabel: string) => (
    <li key={key} className="inline-flex min-h-10 items-center gap-1 rounded-full border border-border bg-surface-2/50 pl-3 text-sm text-ink">
      {label}
      <span className="text-xs text-ink-2">{sub}</span>
      <button type="button" onClick={onRemove} disabled={busy === key} className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-danger focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none" aria-label={removeLabel}>
        {busy === key ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <X className="size-3.5" aria-hidden />}
      </button>
    </li>
  );

  return (
    <SectionCard icon={Tags} title="Section tags" description="Topics, people, places and events used for search and the Scripture Map.">
      <div className="grid grid-cols-1 gap-4">
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-ink-2 uppercase">Topics</h3>
          {d.topics.length === 0 ? (
            <p className="text-sm text-ink-2">No topics yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {d.topics.map((t: Json) => tagChip(`t-${t.id}`, t.name, t.is_human ? "added by a person" : `${Math.round(t.confidence * 100)}%`, () => void patch(`t-${t.id}`, { remove_topics: [t.id] }, `Removed “${t.name}”`), `Remove topic ${t.name}`))}
            </ul>
          )}
          <div className="mt-2.5 flex gap-2">
            <NativeSelect value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic to add" wrapperClassName="flex-1 sm:max-w-xs">
              <option value="">Add a topic…</option>
              {(topics.data || []).map((t: Json) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </NativeSelect>
            <Button variant="outline" disabled={!topic || busy === "add-topic"} onClick={async () => (await patch("add-topic", { add_topics: [topic] }, "Topic added")) && setTopic("")} className="h-10 rounded-xl bg-card px-3.5">
              Add
            </Button>
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-ink-2 uppercase">People, places and events</h3>
          {d.entities.length === 0 ? (
            <p className="text-sm text-ink-2">None yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {d.entities.map((e: Json) => tagChip(`e-${e.id}`, e.name, humanize(e.type).toLowerCase(), () => void patch(`e-${e.id}`, { remove_entities: [e.id] }, `Removed “${e.name}”`), `Remove ${e.name}`))}
            </ul>
          )}
          <div className="mt-2.5 flex gap-2">
            <NativeSelect value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Person, place or event to add" wrapperClassName="flex-1 sm:max-w-xs">
              <option value="">Add a person, place or event…</option>
              {(entities.data || []).map((t: Json) => (
                <option key={t.id} value={t.id}>
                  {humanize(t.type)}: {t.name}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" disabled={!entity || busy === "add-entity"} onClick={async () => (await patch("add-entity", { add_entities: [entity] }, "Added")) && setEntity("")} className="h-10 rounded-xl bg-card px-3.5">
              Add
            </Button>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

// ───────────────────────────────────────────────────────────── history + provenance

function HistoryCard({ d }: { d: Json }) {
  const history: Json[] = d.history || [];
  const feedback: Json[] = d.feedback || [];
  return (
    <SectionCard icon={History} title="History" description="Every decision about this verse link and its section.">
      {history.length === 0 ? (
        <p className="text-sm text-ink-2">No one has reviewed this yet.</p>
      ) : (
        <ol className="relative grid grid-cols-1 gap-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
          {history.map((h) => {
            const action = AUDIT_ACTIONS[h.action];
            return (
              <li key={h.id} className="relative pl-6">
                <span className={cn("absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-card", action?.tone === "ok" ? "bg-ok" : action?.tone === "danger" ? "bg-danger" : action?.tone === "warn" ? "bg-warn" : "bg-[var(--accent-2)]")} aria-hidden />
                <p className="text-sm text-ink">
                  <span className="font-semibold">{h.reviewer_name || "The system"}</span> {action?.verb ?? humanize(h.action).toLowerCase()}{" "}
                  {h.object_type === "mapping" ? "this verse link" : h.object_type === "clip" ? "the clip" : "the section"}
                </p>
                <TimeAgo iso={h.created_at} className="text-xs text-ink-2" />
                {h.note && <p className="mt-1 text-sm text-ink-2 italic">“{h.note}”</p>}
                {(h.previous_value || h.new_value) && (
                  <details className="mt-1.5">
                    <summary className="inline-flex min-h-8 cursor-pointer items-center text-xs font-semibold text-link">Show what changed</summary>
                    <div className="mt-1.5">
                      <ChangeTable before={h.previous_value} after={h.new_value} />
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {feedback.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
            <Flag className="size-4 text-danger" aria-hidden /> Reader reports
          </h3>
          <ul className="grid grid-cols-1 gap-2">
            {feedback.map((f) => (
              <li key={f.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{FEEDBACK_KINDS[f.kind]?.label ?? humanize(f.kind)}</span>
                  <StatusPill tone={FEEDBACK_STATUS[f.status]?.tone ?? "neutral"}>{FEEDBACK_STATUS[f.status]?.label ?? humanize(f.status)}</StatusPill>
                </div>
                {f.note && <p className="mt-1 text-ink-2">“{f.note}”</p>}
                <TimeAgo iso={f.created_at} className="mt-1 block text-xs text-ink-2" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function ProvenanceCard({ m }: { m: Json }) {
  const p = m.provenance || {};
  const detectors: string[] = p.detectors || [];
  return (
    <SectionCard icon={ScanSearch} title="How it was found">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt className="font-medium text-ink-2">Found by</dt>
        <dd className="text-ink">
          {detectors.length ? (
            <ul className="grid grid-cols-1 gap-1">
              {detectors.map((x) => (
                <li key={x}>{DETECTORS[x] ?? x}</li>
              ))}
            </ul>
          ) : p.source === "human" ? (
            "Added by a person"
          ) : (
            "—"
          )}
        </dd>
        <dt className="font-medium text-ink-2">Mentions</dt>
        <dd className="text-ink">{m.mention_count ?? 1} in this section</dd>
        <dt className="font-medium text-ink-2">AI</dt>
        <dd className="text-ink">{p.degraded ? "AI was unavailable, so only non-AI checks ran" : (p.ai_calls || []).length ? `${p.ai_calls.length} AI steps were involved` : "Not used"}</dd>
        <dt className="font-medium text-ink-2">Found</dt>
        <dd className="text-ink">
          <TimeAgo iso={m.created_at} />
        </dd>
      </dl>
      <details className="group mt-4 rounded-xl border border-border">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-ink-2 hover:text-ink">
          Technical details <ArrowRight className="size-4 transition group-open:rotate-90" aria-hidden />
        </summary>
        <pre className="max-h-72 overflow-auto border-t border-border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink">
          {JSON.stringify({ mapping_id: m.id, verse_ref: m.verse_ref, pipeline: m.pipeline_version, run_id: p.run_id, detectors, signals: p.signals, ai_calls: p.ai_calls }, null, 2)}
        </pre>
      </details>
    </SectionCard>
  );
}
