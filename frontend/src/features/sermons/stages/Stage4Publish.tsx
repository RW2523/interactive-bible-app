import {
  ArrowLeft, Camera, Check, CircleCheck, CircleDashed, Download, ExternalLink, FileText, Globe, Hash, LayoutTemplate, Link2, Loader2, Megaphone, MessageSquareText,
  Mic, NotebookPen, Palette, PartyPopper, Presentation, Printer, Share2, Sparkles, Square, ThumbsUp, Trash2, Video, Wand2, X, type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { shareReach } from "@/lib/share";
import { cn } from "@/lib/utils";
import { absoluteUrl, jobKey, sermonApi, sharePathFromDetail, useJob, useStudioMutation } from "../api";
import {
  AiNote, AiProgress, ConfirmDialog, CopyButton, IconTile, LinkButton, MetaPill, SectionCard, StageFooter, StageIntro, TextArea, Toggle, copyToClipboard,
  downloadBlob, fileSafe, formatDuration, plural, readStorage, writeStorage,
} from "../components/StudioUI";
import { openPrintView } from "../lib/exports/print";
import { htmlToStructured } from "../lib/sermon/legacy";
import { normalizeStructured } from "../lib/sermon/structured";
import { SLIDE_COUNT, getTheme, withHash, type ExportTheme } from "../lib/sermon/templates";
import type { SlidePlan, StructuredSermon } from "../types";
import { useWorkspace } from "../workspace";

const PLAN_HINTS = [
  "Reading your sermon section by section…",
  "Choosing a layout for every slide…",
  "Finding places, journeys and timelines to illustrate…",
  "Painting scene images…",
  "Saving your slide outline…",
];
const NOTES_HINTS = ["Reading your sermon…", "Adding delivery tips, timing and transitions…", "Writing altar-call guidance…"];
const OUTREACH_HINTS = ["Summarizing your message…", "Writing posts for each platform…", "Choosing hashtags…"];

const LAYOUT_LABEL: Record<string, string> = {
  cover: "Cover",
  fullBleedCaption: "Full picture",
  split: "Picture & text",
  figure: "Figure",
  showcase: "Showcase",
  scripture: "Scripture",
  bigStat: "Big statement",
  bento: "Tiles",
  threeCol: "Three points",
  timelineSlide: "Sequence",
  pullQuote: "Quote",
  twoUp: "Comparison",
  sectionDivider: "Section",
  closing: "Closing",
};
const VISUAL_LABEL: Record<string, string> = { scene: "scene image", scriptureArt: "verse art", map: "map", route: "route", timeline: "timeline", diagram: "diagram" };

const planTargetKey = (draftId: string) => `ibible_sermon_plan_target_${draftId}`;

const scrollToSection = (id: string) => {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
};

export function Stage4Publish() {
  const { id, sermon, draft, media, outreach, detail, cache, track, goToStage, options, active, flushEditor } = useWorkspace();

  // ───────────────────────────── design
  const [templateId, setTemplateId] = useState<string>(sermon.export_template || "navy_gold");
  useEffect(() => {
    if (sermon.export_template) setTemplateId(sermon.export_template);
  }, [sermon.export_template]);
  const theme = getTheme(templateId);
  const [slideCount, setSlideCount] = useState<number>(SLIDE_COUNT.default);
  const plan = draft?.slide_plan?.slides?.length ? draft.slide_plan : null;
  const [confirmRedesign, setConfirmRedesign] = useState(false);

  const persistTheme = (themeId: string) => {
    if (themeId === templateId) return;
    setTemplateId(themeId);
    cache.patch((d) => ({ ...d, sermon: { ...d.sermon, export_template: themeId } }));
    void track(sermonApi.update(id, { export_template: themeId }), "Couldn't save the theme").catch(() => undefined);
  };

  const planKey = jobKey(id, 4, "plan");
  const planJob = useJob(planKey);
  const planDeck = useStudioMutation(
    planKey,
    (v: { theme_id: string; target_slide_count: number; draftId: string | null }) => sermonApi.plan(id, { theme_id: v.theme_id, target_slide_count: v.target_slide_count }),
    {
      onSuccess: (res, v) => {
        if (res.plan) cache.patch((d) => (d.draft ? { ...d, draft: { ...d.draft, slide_plan: res.plan } } : d));
        if (v.draftId) writeStorage(planTargetKey(v.draftId), v.target_slide_count);
        const n = res.plan?.slides?.length ?? 0;
        const details = [
          res.scenes_generated ? `${plural(res.scenes_generated, "new scene image")}` : null,
          res.scenes_reused ? `${plural(res.scenes_reused, "image")} reused` : null,
          res.scenes_failed ? `${res.scenes_failed} ${res.scenes_failed === 1 ? "image" : "images"} couldn't be created` : null,
        ].filter(Boolean);
        toast.success(`Slides designed — ${plural(n, "slide")}`, details.length ? { description: details.join(" · ") } : undefined);
      },
      errorTitle: "Couldn't design the slides",
    },
  );

  const ensurePlan = async (force: boolean): Promise<SlidePlan | null> => {
    const current = cache.get()?.draft ?? draft;
    if (!force && current?.slide_plan?.slides?.length) return current.slide_plan;
    try {
      const res = await planDeck.mutateAsync({ theme_id: templateId, target_slide_count: slideCount, draftId: current?.id ?? null });
      return res.plan ?? null;
    } catch {
      return null; // the export falls back to a content-faithful deck
    }
  };

  const runDesignDeck = async () => {
    setConfirmRedesign(false);
    if (!draft) return void toast.error("Write your draft in Polish first");
    await flushEditor();
    void ensurePlan(true);
  };

  // ───────────────────────────── exports
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingPpt, setExportingPpt] = useState(false);

  const resolveStructured = (): StructuredSermon | null => {
    const d = cache.get()?.draft ?? draft;
    if (!d) return null;
    return d.structured ? normalizeStructured(d.structured, sermon.title) : htmlToStructured(d.polished_html ?? "", sermon.title);
  };

  const [notes, setNotes] = useState(draft?.speaker_notes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const speakerNotes = notes.trim() ? notes : (draft?.speaker_notes ?? null);

  const openPrint = (target: Window | null, forPdf: boolean) => {
    const structured = resolveStructured();
    if (!structured) {
      target?.close();
      return void toast.error("Write your draft in Polish first");
    }
    const ok = openPrintView(sermon, structured, media, { templateId, speakerNotes, language: sermon.language, target });
    if (!ok) return void toast.error("Couldn't open the print view", { description: "Allow pop-ups for this site and try again." });
    if (forPdf) toast.info(`Opened a print view for ${sermon.language}`, { description: "Choose “Save as PDF” in the print dialog — it renders every script faithfully." });
    else toast.success("Print view opened", { description: "Use Ctrl/Cmd + P to print or save as PDF." });
  };

  const exportPdf = async () => {
    if (!draft) return void toast.error("Write your draft in Polish first");
    if (options.isComplexScript(sermon.language)) {
      // Open synchronously inside the click so pop-up blockers allow it.
      const win = window.open("", "_blank");
      await flushEditor();
      return openPrint(win, true);
    }
    setExportingPdf(true);
    try {
      await flushEditor();
      const structured = resolveStructured();
      if (!structured) return void toast.error("Write your draft in Polish first");
      const { generatePDF } = await import("../lib/exports/pdf");
      const formatLabel = options.templateLabel(cache.get()?.draft?.template_type ?? draft.template_type);
      const blob = await generatePDF(sermon, structured, media, { templateId, formatLabel, slidePlan: cache.get()?.draft?.slide_plan ?? plan });
      downloadBlob(blob, `${fileSafe(sermon.title)}.pdf`);
      toast.success("PDF downloaded", { description: "Look for it in your Downloads folder." });
    } catch (err) {
      console.error(err);
      toast.error("PDF export failed — please try again");
    } finally {
      setExportingPdf(false);
    }
  };

  const exportPpt = async () => {
    if (!draft) return void toast.error("Write your draft in Polish first");
    setExportingPpt(true);
    try {
      await flushEditor();
      const structured = resolveStructured();
      if (!structured) return void toast.error("Write your draft in Polish first");
      // Re-plan only when the slide count has moved well away from what the plan was designed for.
      const current = cache.get()?.draft ?? draft;
      const plannedFor = readStorage<number>(planTargetKey(current.id));
      const replan = !!current.slide_plan?.slides?.length && typeof plannedFor === "number" && Math.abs(plannedFor - slideCount) > 4;
      const deckPlan = await ensurePlan(replan);
      const { generatePPT } = await import("../lib/exports/ppt");
      const blob = await generatePPT(sermon, structured, media, { templateId, slideCount, speakerNotes, slidePlan: deckPlan });
      downloadBlob(blob, `${fileSafe(sermon.title)}.pptx`);
      toast.success("PowerPoint downloaded", { description: "Look for it in your Downloads folder." });
    } catch (err) {
      console.error(err);
      toast.error("PowerPoint export failed — please try again");
    } finally {
      setExportingPpt(false);
    }
  };

  const printNotes = async () => {
    if (!draft) return void toast.error("Write your draft in Polish first");
    const win = window.open("", "_blank");
    await flushEditor();
    openPrint(win, false);
  };

  // ───────────────────────────── speaker notes
  const notesKey = jobKey(id, 4, "notes");
  const notesJob = useJob(notesKey);
  const [showNotes, setShowNotes] = useState(!!draft?.speaker_notes);
  const [confirmNotes, setConfirmNotes] = useState(false);
  useEffect(() => {
    if (!notesDirty) setNotes(draft?.speaker_notes ?? "");
  }, [draft?.speaker_notes, notesDirty]);

  const generateNotes = useStudioMutation(notesKey, (draftId: string) => sermonApi.speakerNotes(id, draftId), {
    onSuccess: (res, draftId) => {
      cache.patch((d) =>
        d.draft && d.draft.id === draftId ? { ...d, draft: { ...d.draft, ...(res.draft ?? {}), speaker_notes: res.draft?.speaker_notes ?? res.notes } } : d,
      );
      toast.success("Speaker notes are ready", { description: "They're included in your PowerPoint and print view." });
    },
    errorTitle: "Couldn't write speaker notes",
  });

  const runGenerateNotes = async () => {
    setConfirmNotes(false);
    if (!draft) return void toast.error("Write your draft in Polish first");
    await flushEditor();
    setNotesDirty(false);
    setShowNotes(true);
    generateNotes.mutate(draft.id);
  };

  const [savingNotes, setSavingNotes] = useState(false);
  const saveNotes = async (auto = false) => {
    if (!draft) return;
    const text = notesRef.current;
    setSavingNotes(true);
    try {
      const saved = await track(sermonApi.updateDraft(id, draft.id, { speaker_notes: text }), "Couldn't save speaker notes");
      cache.patch((d) => (d.draft && d.draft.id === draft.id ? { ...d, draft: { ...d.draft, ...(saved ?? {}), speaker_notes: saved?.speaker_notes ?? text } } : d));
      setNotesDirty(notesRef.current !== text);
      if (!auto) toast.success("Speaker notes saved");
    } catch {
      /* reported by track */
    } finally {
      setSavingNotes(false);
    }
  };
  const saveNotesRef = useRef(saveNotes);
  saveNotesRef.current = saveNotes;

  // Autosave speaker notes after a short pause in typing.
  useEffect(() => {
    if (!notesDirty || savingNotes) return;
    const t = window.setTimeout(() => void saveNotesRef.current(true), 2000);
    return () => window.clearTimeout(t);
  }, [notes, notesDirty, savingNotes]);

  // ───────────────────────────── narration video
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [narration, setNarration] = useState<{ blob: Blob; url: string; duration: number } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [video, setVideo] = useState<{ url: string; ext: string } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAt = useRef(0);
  const urlsRef = useRef<{ narration: string | null; video: string | null }>({ narration: null, video: null });

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecordSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [recording]);

  const releaseMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        releaseMic();
      }
    }
    setRecording(false);
  };

  // Release the microphone when leaving the Publish step or the workspace mid-recording.
  useEffect(() => {
    if (active !== 4 && recorderRef.current?.state === "recording") stopRecording();
  }, [active]);
  useEffect(
    () => () => {
      const rec = recorderRef.current;
      if (rec) rec.onstop = null;
      try {
        if (rec && rec.state !== "inactive") rec.stop();
      } catch {
        /* already stopped */
      }
      releaseMic();
      if (urlsRef.current.narration) URL.revokeObjectURL(urlsRef.current.narration);
      if (urlsRef.current.video) URL.revokeObjectURL(urlsRef.current.video);
    },
    [],
  );

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return void toast.error("Recording isn't supported in this browser");
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        const duration = (Date.now() - startedAt.current) / 1000;
        releaseMic();
        if (urlsRef.current.narration) URL.revokeObjectURL(urlsRef.current.narration);
        const url = URL.createObjectURL(blob);
        urlsRef.current.narration = url;
        setNarration({ blob, url, duration });
      };
      recorderRef.current = recorder;
      startedAt.current = Date.now();
      setRecordSeconds(0);
      recorder.start(250);
      setRecording(true);
    } catch (err) {
      releaseMic();
      const e = err as DOMException;
      if (e?.name === "NotAllowedError") toast.error("Microphone access denied", { description: "Allow microphone access in your browser settings to record." });
      else if (e?.name === "NotFoundError") toast.error("No microphone found on this device");
      else toast.error("Couldn't start recording", { description: e?.message });
    }
  };

  const discardNarration = () => {
    setConfirmDiscard(false);
    if (urlsRef.current.narration) URL.revokeObjectURL(urlsRef.current.narration);
    urlsRef.current.narration = null;
    setNarration(null);
  };

  const videoImages = () => {
    const fromMedia = [...media]
      .sort((a, b) => a.order_index - b.order_index)
      .map((m) => m.url)
      .filter((u): u is string => !!u);
    const fromPlan = (cache.get()?.draft?.slide_plan?.slides ?? []).map((s) => s.visual?.imageUrl).filter((u): u is string => !!u);
    return Array.from(new Set([...fromMedia, ...fromPlan]));
  };

  const renderVideo = async () => {
    if (!narration) return void toast.error("Record your narration first");
    const images = videoImages();
    if (!images.length) return void toast.error("Add visuals first", { description: "Create visuals in the Visuals step (or design your slides) for the video background." });
    setRendering(true);
    setProgress(0);
    try {
      const { renderAudioVideo, pickVideoMimeType, extensionForMime } = await import("../lib/exports/video");
      const blob = await renderAudioVideo({ audioBlob: narration.blob, images, title: sermon.title, onProgress: setProgress, fallbackDurationSec: narration.duration });
      if (urlsRef.current.video) URL.revokeObjectURL(urlsRef.current.video);
      const url = URL.createObjectURL(blob);
      urlsRef.current.video = url;
      setVideo({ url, ext: extensionForMime(blob.type || pickVideoMimeType()) });
      toast.success("Your video is ready", { description: "Download it below." });
    } catch (err) {
      console.error(err);
      toast.error("Video rendering failed", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setRendering(false);
    }
  };

  // ───────────────────────────── outreach + publish
  const outreachKey = jobKey(id, 4, "outreach");
  const outreachJob = useJob(outreachKey);
  const [confirmOutreach, setConfirmOutreach] = useState(false);
  const generateOutreach = useStudioMutation(outreachKey, () => sermonApi.generateOutreach(id), {
    onSuccess: (res) => {
      if (res.outreach) cache.patch((d) => ({ ...d, outreach: { ...res.outreach, social: res.social ?? res.outreach.social ?? d.outreach?.social ?? null } }));
      else void cache.refresh();
      toast.success("Summary and social posts are ready");
    },
    errorTitle: "Couldn't write the summary and posts",
  });

  const publishKey = jobKey(id, 4, "publish");
  const publishJob = useJob(publishKey);
  const setPublic = useStudioMutation(publishKey, (isPublic: boolean) => sermonApi.setPublic(id, isPublic), {
    onSuccess: (res, isPublic) => {
      cache.patch((d) => ({
        ...d,
        outreach: res.outreach
          ? { ...(d.outreach ?? {}), ...res.outreach, social: res.outreach.social ?? d.outreach?.social ?? null }
          : d.outreach
            ? { ...d.outreach, is_public: isPublic }
            : d.outreach,
        sermon: res.sermon ? { ...d.sermon, ...res.sermon, current_stage: d.sermon.current_stage } : { ...d.sermon, status: isPublic ? "published" : "exported" },
      }));
      toast.success(isPublic ? "Your sermon is published" : "Sermon unpublished", {
        description: isPublic ? "Anyone with the link can now read it. Copy the link to share it." : "The share link no longer works. You can publish again any time.",
      });
    },
    errorTitle: "Couldn't change publishing",
  });
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

  const runGenerateOutreach = async () => {
    setConfirmOutreach(false);
    if (!draft) return void toast.error("Write your draft in Polish first");
    await flushEditor();
    generateOutreach.mutate();
  };
  const onGenerateOutreach = () => (outreach ? setConfirmOutreach(true) : void runGenerateOutreach());

  const isPublic = !!outreach?.is_public;
  const sharePath = sharePathFromDetail(detail);
  const shareUrl = sharePath ? absoluteUrl(sharePath) : null;
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const social = outreach?.social ?? null;
  const thread: string[] = Array.isArray(social?.twitter_thread)
    ? social.twitter_thread.map((t) => String(t).trim()).filter(Boolean)
    : typeof social?.twitter_thread === "string" && social.twitter_thread.trim()
      ? social.twitter_thread
          .split(/\n{2,}/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
  const hashtags = (outreach?.hashtags ?? []).map((h) => h.replace(/^#/, "").trim()).filter(Boolean);

  const planSlides = plan?.slides.length ?? 0;
  const pptBusy = exportingPpt || planJob.pending;
  const hasNotes = !!(notes.trim() || draft?.speaker_notes);

  const checklist: { label: string; detail: string; done: boolean; optional?: boolean; onClick: () => void }[] = [
    { label: "Draft written", detail: draft ? `Version ${draft.version}` : "In Polish", done: !!draft, onClick: () => goToStage(2) },
    { label: "Visuals", detail: media.length ? plural(media.length, "visual") : "Optional", done: media.length > 0, optional: true, onClick: () => goToStage(3) },
    { label: "Slides designed", detail: planSlides ? plural(planSlides, "slide") : "Not yet", done: planSlides > 0, onClick: () => scrollToSection("publish-design") },
    { label: "Speaker notes", detail: hasNotes ? "Ready" : "Not yet", done: hasNotes, optional: true, onClick: () => scrollToSection("publish-notes") },
    { label: "Summary & posts", detail: outreach ? "Ready" : "Needed to publish", done: !!outreach, onClick: () => scrollToSection("publish-outreach") },
    { label: "Published", detail: isPublic ? "Live" : "Not yet", done: isPublic, onClick: () => scrollToSection("publish-share") },
  ];

  return (
    <div className="grid grid-cols-1 gap-6">
      <StageIntro stage={4} aside={isPublic ? <MetaPill tone="ok" icon={CircleCheck}>Published</MetaPill> : undefined}>
        {isPublic
          ? "Your sermon is live. Download your slides and manuscript for Sunday, or share the link with your church."
          : "Choose a look, download your PDF or PowerPoint, and publish a page your church can read online."}
      </StageIntro>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
        {/* ── Share + checklist (first on phones, a sticky side panel on large screens) ── */}
        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2 xl:sticky xl:top-[calc(var(--header-h)+4.5rem)] xl:col-start-2 xl:row-span-4 xl:row-start-1 xl:grid-cols-1" aria-label="Publishing">
          <section
            id="publish-share"
            aria-labelledby="publish-share-title"
            className={cn(
              "scroll-mt-[calc(var(--header-h)+5rem)] rounded-2xl border bg-card p-4 shadow-xs sm:p-5",
              isPublic ? "border-ok/40" : "border-border",
            )}
          >
            <div className="flex items-start gap-3">
              <IconTile icon={Globe} className={cn(isPublic && "bg-[var(--ok-soft)] text-ok dark:bg-[var(--ok-soft)] dark:text-ok")} />
              <div className="min-w-0 self-center">
                <h2 id="publish-share-title" className="font-display text-lg leading-snug font-semibold tracking-tight text-ink">
                  Share page
                </h2>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-2">A beautiful page your church can read on any phone or computer.</p>
              </div>
            </div>

            {outreach ? (
              <div className="mt-4 rounded-xl border border-border bg-paper-2/60 p-3.5 dark:bg-surface-2/30">
                <Toggle
                  checked={isPublic}
                  disabled={publishJob.pending}
                  onChange={(v) => (v ? setPublic.mutate(true) : setConfirmUnpublish(true))}
                  label={
                    <span className="inline-flex items-center gap-2">
                      {isPublic ? "Published" : "Not published"}
                      {publishJob.pending && <Loader2 className="size-3.5 animate-spin text-ink-3" aria-hidden />}
                    </span>
                  }
                  description={isPublic ? "Anyone with the link can read it. Switch off to unpublish." : "Only you can see this sermon. Switch on to publish it."}
                />
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-2.5 rounded-xl border border-dashed border-border p-3.5">
                <p className="text-sm leading-relaxed text-ink-2">
                  To publish, first create a short summary for the page (with social posts to share it).
                </p>
                <Button onClick={() => void runGenerateOutreach()} disabled={outreachJob.pending || !draft} className="h-11 gap-2 rounded-xl sm:h-10">
                  {outreachJob.pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {outreachJob.pending ? "Writing your summary…" : "Create summary & posts"}
                </Button>
                <AiNote>{draft ? "About 20–40 seconds." : "Available once your draft is written."}</AiNote>
              </div>
            )}

            {isPublic && shareUrl && (
              <div className="mt-4 grid grid-cols-1 gap-2">
                <label htmlFor="share-url" className="text-[13px] font-semibold text-ink-2">
                  Share link
                </label>
                <input
                  id="share-url"
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-sm text-link outline-none focus:border-gold-500/60 focus:ring-3 focus:ring-ring sm:h-10 dark:bg-surface-2/40"
                />
                {shareReach() !== "unknown" && (
                  <p className="text-xs leading-relaxed text-ink-3">
                    {shareReach() === "network"
                      ? "Opens on phones and computers connected to the same network as this computer. To share it beyond your network, set PUBLIC_BASE_URL (see the user manual)."
                      : "This link only opens on this computer. Connect to a network, or set PUBLIC_BASE_URL, to share it with others."}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        await copyToClipboard(shareUrl);
                        toast.success("Share link copied", { description: "Paste it into a message, an email or your church website." });
                      } catch {
                        toast.error("Couldn't copy", { description: shareUrl });
                      }
                    }}
                    className="h-11 gap-2 rounded-xl sm:h-10"
                  >
                    <Link2 className="size-4" /> Copy link
                  </Button>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background text-sm font-medium text-ink no-underline transition hover:bg-muted hover:no-underline sm:h-10 dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
                  >
                    <ExternalLink className="size-4" aria-hidden /> View page
                  </a>
                </div>
                {canNativeShare && (
                  <Button
                    variant="ghost"
                    onClick={() => void navigator.share({ title: sermon.title, text: outreach?.social_caption ?? outreach?.summary ?? sermon.title, url: shareUrl }).catch(() => undefined)}
                    className="h-11 gap-2 rounded-xl sm:h-10"
                  >
                    <Share2 className="size-4" /> Share…
                  </Button>
                )}
              </div>
            )}
          </section>

          <section aria-labelledby="publish-checklist-title" className="rounded-2xl border border-border bg-card p-4 shadow-xs sm:p-5">
            <h2 id="publish-checklist-title" className="text-sm font-semibold text-ink">
              Ready for Sunday?
            </h2>
            <ul className="mt-2 grid grid-cols-1 gap-0.5">
              {checklist.map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    onClick={item.onClick}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring"
                  >
                    {item.done ? (
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--ok-soft)] text-ok" aria-hidden>
                        <Check className="size-3.5" strokeWidth={3} />
                      </span>
                    ) : (
                      <CircleDashed className="size-6 shrink-0 text-ink-3" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm font-medium", item.done ? "text-ink" : "text-ink-2")}>{item.label}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-3">
                      <span className="sr-only">{item.done ? "done" : "not done"}: </span>
                      {item.detail}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        {/* ── Look & slides ── */}
        <SectionCard
          id="publish-design"
          icon={Palette}
          title="Look & slides"
          description="Pick a theme for your PDF, PowerPoint and print view — it's saved with this sermon."
          className="min-w-0 xl:col-start-1 xl:row-start-1"
        >
          <p id="export-theme-label" className="mb-2.5 text-[13px] font-semibold text-ink-2">
            Theme
          </p>
          <div role="group" aria-labelledby="export-theme-label" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {options.themes.map((th) => (
              <ThemeSwatch key={th.id} theme={th} selected={th.id === templateId} onSelect={() => persistTheme(th.id)} />
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-border bg-paper-2/60 p-4 dark:bg-surface-2/30">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <IconTile icon={LayoutTemplate} size="sm" />
                <div className="min-w-0">
                  <p className="font-semibold text-ink">Slide deck</p>
                  <p className="mt-0.5 max-w-xl text-sm leading-relaxed text-ink-2">
                    AI gives every slide a layout and the right picture — a map for places, a timeline for events, verse art for Scripture, or clean text.
                  </p>
                </div>
              </div>
              {planSlides > 0 ? <MetaPill tone="gold">{plural(planSlides, "slide")} designed</MetaPill> : <MetaPill>Not designed yet</MetaPill>}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label htmlFor="slide-count" className="text-[13px] font-semibold text-ink-2">
                    Slides for PowerPoint
                  </label>
                  <span className="rounded-full bg-surface px-2.5 py-0.5 text-sm font-semibold text-ink tabular-nums dark:bg-surface-2">about {slideCount}</span>
                </div>
                <input
                  id="slide-count"
                  type="range"
                  min={SLIDE_COUNT.min}
                  max={SLIDE_COUNT.max}
                  step={1}
                  value={slideCount}
                  onChange={(e) => setSlideCount(Number(e.target.value))}
                  aria-valuetext={`about ${slideCount} slides`}
                  className="h-2 w-full cursor-pointer accent-primary"
                />
                <div className="mt-1.5 flex justify-between text-xs text-ink-3">
                  <span>Fewer, fuller slides</span>
                  <span>More, lighter slides</span>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                <Button
                  variant={planSlides ? "outline" : "default"}
                  onClick={() => (planSlides ? setConfirmRedesign(true) : void runDesignDeck())}
                  disabled={planJob.pending || !draft}
                  className="h-11 gap-2 rounded-xl px-4 sm:h-10"
                >
                  {planJob.pending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                  {planJob.pending ? "Designing…" : planSlides ? "Redesign slides" : "Design my slides"}
                </Button>
              </div>
            </div>
            <AiNote className="mt-3">
              Takes 1–2 minutes (images are reused where possible). Nothing from your sermon is cut — a long sermon may need more slides.
            </AiNote>
          </div>
          <AiProgress since={planJob.since} label="Designing your slides…" hints={PLAN_HINTS} estimate="1–2 minutes" className="mt-4" />
          {plan && <SlideStrip plan={plan} theme={theme} />}
        </SectionCard>

        {/* ── Downloads ── */}
        <SectionCard
          id="publish-downloads"
          icon={Download}
          title="Download & present"
          description="Everything you need for Sunday, in your chosen theme."
          className="min-w-0 xl:col-start-1 xl:row-start-2"
          bodyClassName="p-0"
        >
          <ExportGroup title="Files to download">
            <ExportRow
              icon={FileText}
              title="PDF manuscript"
              description={
                options.isComplexScript(sermon.language)
                  ? `Opens a print view that renders ${sermon.language} perfectly — choose “Save as PDF”.`
                  : "Your full sermon, beautifully formatted for reading or printing."
              }
            >
              <Button onClick={() => void exportPdf()} disabled={exportingPdf || !draft} className="h-11 w-full gap-2 rounded-xl px-4 sm:h-10 sm:w-44">
                {exportingPdf ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                {exportingPdf ? "Preparing…" : "Download PDF"}
              </Button>
            </ExportRow>
            <ExportRow
              icon={Presentation}
              title="PowerPoint slides"
              description={
                planSlides
                  ? `Your ${plural(planSlides, "designed slide")}, with speaker notes included.`
                  : "Designed slides with speaker notes included. Slides are designed first if needed (1–2 minutes)."
              }
            >
              <Button onClick={() => void exportPpt()} disabled={pptBusy || !draft} className="h-11 w-full gap-2 rounded-xl px-4 sm:h-10 sm:w-44">
                {pptBusy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                {planJob.pending ? "Designing slides…" : exportingPpt ? "Preparing…" : "Download slides"}
              </Button>
            </ExportRow>
          </ExportGroup>

          <ExportGroup title="Print & video">
            <ExportRow icon={Printer} title="Print view" description="Printable sermon notes with your visuals and speaker notes. Opens in a new tab.">
              <Button variant="outline" onClick={() => void printNotes()} disabled={!draft} className="h-11 w-full gap-2 rounded-xl px-4 sm:h-10 sm:w-44">
                <Printer className="size-4" /> Open print view
              </Button>
            </ExportRow>
            <div className="py-4">
              <div className="flex items-start gap-3">
                <IconTile icon={Video} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">Sermon video</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-2">
                    Record yourself preaching or reading — your visuals play behind your voice. The video is made in this tab, in real time.
                  </p>
                </div>
              </div>
              <ol className="mt-4 grid grid-cols-1 gap-3 sm:pl-[3.25rem]">
                <li className="grid grid-cols-1 gap-2">
                  <span className="text-xs font-semibold tracking-wide text-ink-3 uppercase">1 · Record your voice</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant={recording ? "destructive" : "outline"}
                      onClick={() => (recording ? stopRecording() : void startRecording())}
                      disabled={rendering}
                      aria-pressed={recording}
                      className="h-11 gap-2 rounded-xl px-4 sm:h-10"
                    >
                      {recording ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
                      {recording ? "Stop recording" : narration ? "Record again" : "Start recording"}
                    </Button>
                    {(recording || narration) && (
                      <span
                        className={cn("rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums", recording ? "bg-red-600 text-white" : "bg-surface-2 text-ink-2")}
                        role={recording ? "timer" : undefined}
                      >
                        {recording && <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-white align-middle" aria-hidden />}
                        {formatDuration(recording ? recordSeconds : (narration?.duration ?? 0))}
                      </span>
                    )}
                  </div>
                  {narration && !recording && (
                    <div className="flex flex-wrap items-center gap-2">
                      <audio controls src={narration.url} className="h-10 min-w-0 flex-1 basis-56" aria-label="Your recorded narration" />
                      {confirmDiscard ? (
                        <span className="flex items-center gap-1.5">
                          <Button variant="destructive" onClick={discardNarration} className="h-10 rounded-lg px-3 sm:h-9">
                            Discard
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirmDiscard(false)} className="h-10 rounded-lg px-3 sm:h-9" aria-label="Keep recording">
                            <X className="size-4" />
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setConfirmDiscard(true)}
                          disabled={rendering}
                          aria-label="Discard recording"
                          title="Discard recording"
                          className="size-10 rounded-lg text-ink-3 hover:text-danger sm:size-9"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </li>
                <li className="grid grid-cols-1 gap-2">
                  <span className="text-xs font-semibold tracking-wide text-ink-3 uppercase">2 · Make the video</span>
                  {rendering && (
                    <div className="grid grid-cols-1 gap-1" role="status" aria-live="polite">
                      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-gold-400 transition-[width] duration-300" style={{ width: `${progress}%` }} />
                      </div>
                      <p className="text-xs text-ink-3">{progress}% — it plays in real time, so keep this tab open.</p>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button onClick={() => void renderVideo()} disabled={rendering || recording || !narration} className="h-11 gap-2 rounded-xl px-4 sm:h-10">
                      {rendering ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}
                      {rendering ? `Making video ${progress}%…` : "Make video"}
                    </Button>
                    {video && !rendering && (
                      <a
                        href={video.url}
                        download={`${fileSafe(sermon.title)}.${video.ext}`}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-gold-400/50 px-4 text-sm font-medium text-gold-700 no-underline transition hover:bg-gold-400/10 hover:no-underline sm:h-10 dark:text-gold-300"
                      >
                        <Download className="size-4" aria-hidden /> Download video
                      </a>
                    )}
                  </div>
                  {!narration && !recording && <p className="text-xs text-ink-3">Record your voice first.</p>}
                </li>
              </ol>
            </div>
          </ExportGroup>
        </SectionCard>

        {/* ── Speaker notes ── */}
        <SectionCard
          id="publish-notes"
          icon={NotebookPen}
          title="Speaker notes"
          description="Delivery tips, timing, transitions and altar-call guidance — included in your PowerPoint and print view."
          className="min-w-0 xl:col-start-1 xl:row-start-3"
          action={
            hasNotes ? (
              <Button variant="ghost" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes} className="h-10 rounded-lg px-3 text-ink-2 sm:h-9">
                {showNotes ? "Hide notes" : "Show notes"}
              </Button>
            ) : null
          }
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <AiNote className="max-w-md">
              {draft ? "AI writes notes from your current draft — about 30 seconds. You can edit them afterwards." : "Available once your draft is written."}
            </AiNote>
            <Button
              onClick={() => (hasNotes ? setConfirmNotes(true) : void runGenerateNotes())}
              disabled={notesJob.pending || !draft}
              variant={hasNotes ? "outline" : "default"}
              className="h-11 shrink-0 gap-2 rounded-xl px-4 sm:h-10"
            >
              {notesJob.pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {notesJob.pending ? "Writing notes…" : hasNotes ? "Rewrite speaker notes" : "Write speaker notes"}
            </Button>
          </div>
          <AiProgress since={notesJob.since} label="Writing your speaker notes…" hints={NOTES_HINTS} estimate="about 30 seconds" className="mt-4" />
          {showNotes && hasNotes && (
            <div className="mt-4 grid grid-cols-1 gap-2">
              <TextArea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setNotesDirty(true);
                }}
                aria-label="Speaker notes"
                className="min-h-[260px] text-[14px] leading-relaxed"
                placeholder="Speaker notes will appear here…"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-ink-3" aria-live="polite">
                  {savingNotes ? "Saving…" : notesDirty ? "Unsaved changes — saving shortly" : "Saved with your draft"}
                </span>
                <Button
                  variant={notesDirty ? "default" : "ghost"}
                  onClick={() => void saveNotes(false)}
                  disabled={!notesDirty || savingNotes}
                  className="h-10 gap-2 rounded-xl px-3.5 sm:h-9"
                >
                  {savingNotes ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {notesDirty ? "Save now" : "Saved"}
                </Button>
              </div>
            </div>
          )}
        </SectionCard>

        {/* ── Outreach ── */}
        <SectionCard
          id="publish-outreach"
          icon={Megaphone}
          title="Summary & social posts"
          description="A short summary for your share page, plus posts ready to copy for Instagram, Facebook and X."
          className="min-w-0 xl:col-start-1 xl:row-start-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <AiNote className="max-w-md">
              {!draft
                ? "Available once your draft is written."
                : outreach
                  ? "AI rewrites these from your current draft — about 20–40 seconds. Your share link stays the same."
                  : "AI writes these from your current draft — about 20–40 seconds. The summary also introduces your share page."}
            </AiNote>
            <Button
              onClick={onGenerateOutreach}
              disabled={outreachJob.pending || !draft}
              variant={outreach ? "outline" : "default"}
              className="h-11 shrink-0 gap-2 rounded-xl px-4 sm:h-10"
            >
              {outreachJob.pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {outreachJob.pending ? "Writing…" : outreach ? "Rewrite summary & posts" : "Write summary & posts"}
            </Button>
          </div>
          <AiProgress since={outreachJob.since} label="Writing your summary and posts…" hints={OUTREACH_HINTS} estimate="20–40 seconds" className="mt-4" />
          {outreach ? (
            <div className="mt-5 grid grid-cols-1 gap-5">
              {outreach.summary && <CopyBlock label="Summary for your church" text={outreach.summary} serif />}
              {outreach.social_caption && <CopyBlock label="Short caption" text={outreach.social_caption} />}
              {hashtags.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-ink-3 uppercase">
                      <Hash className="size-3.5" aria-hidden /> Hashtags
                    </span>
                    <CopyButton text={hashtags.map((h) => `#${h}`).join(" ")} label="Copy all" withText toastMessage="Hashtags copied" />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {hashtags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        title="Copy hashtag"
                        onClick={async () => {
                          try {
                            await copyToClipboard(`#${tag}`);
                            toast.success(`Copied #${tag}`);
                          } catch {
                            toast.error("Couldn't copy");
                          }
                        }}
                        className="h-9 rounded-full bg-[var(--gold-soft)] px-3 text-[13px] font-medium text-gold-700 dark:text-gold-300 transition outline-none hover:ring-1 hover:ring-gold-400/60 focus-visible:ring-3 focus-visible:ring-ring sm:h-8"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(social?.instagram_caption || social?.facebook_post || thread.length > 0) && (
                <div className="grid grid-cols-1 gap-5 border-t border-border pt-5">
                  {social?.instagram_caption && <CopyBlock label="Instagram" icon={Camera} text={social.instagram_caption} />}
                  {social?.facebook_post && <CopyBlock label="Facebook" icon={ThumbsUp} text={social.facebook_post} />}
                  {thread.length > 0 && (
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-ink-3 uppercase">
                          <MessageSquareText className="size-3.5" aria-hidden /> X / Twitter thread
                        </span>
                        <CopyButton text={thread.map((t, i) => `${i + 1}/${thread.length} ${t}`).join("\n\n")} label="Copy thread" withText toastMessage="Thread copied" />
                      </div>
                      <ol className="grid grid-cols-1 gap-2">
                        {thread.map((tweet, i) => (
                          <li key={i} className="relative rounded-xl border border-border bg-paper-2/60 py-2.5 pr-12 pl-3 sm:pr-11 dark:bg-surface-2/30">
                            <span className="text-xs font-semibold text-ink-3">
                              {i + 1}/{thread.length}
                            </span>
                            <p className="mt-0.5 text-sm leading-relaxed whitespace-pre-line text-ink">{tweet}</p>
                            <span className={cn("text-[11px] tabular-nums", tweet.length > 280 ? "text-danger" : "text-ink-3")}>{tweet.length}/280 characters</span>
                            <CopyButton text={tweet} label={`Copy post ${i + 1}`} className="absolute top-1 right-1" />
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}
              {!social?.instagram_caption && !social?.facebook_post && thread.length === 0 && (outreach.summary || outreach.social_caption) && (
                <p className="text-xs text-ink-3">Rewrite to also get posts for Instagram, Facebook and X.</p>
              )}
            </div>
          ) : (
            !outreachJob.pending && (
              <p className="mt-4 rounded-xl bg-surface-2/60 px-4 py-5 text-center text-sm text-ink-3">
                {draft ? "Nothing written yet. Your summary is also what people see first on your share page." : "Available once your draft is written."}
              </p>
            )
          )}
        </SectionCard>
      </div>

      <StageFooter
        onBack={() => goToStage(3)}
        backLabel="Back to Visuals"
        hint={
          isPublic ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-ok">
              <PartyPopper className="size-4" aria-hidden /> Your sermon is complete and published.
            </span>
          ) : (
            "Publish when you're ready — you can unpublish at any time."
          )
        }
      >
        <LinkButton to="/sermons" variant={isPublic ? "default" : "outline"} className="h-12 w-full gap-2 rounded-xl px-5 text-[15px] font-semibold sm:w-auto">
          <ArrowLeft className="size-4" /> All sermons
        </LinkButton>
      </StageFooter>

      <ConfirmDialog
        open={confirmNotes}
        onOpenChange={setConfirmNotes}
        title="Rewrite your speaker notes?"
        description="New notes will be written from your current draft and replace the notes you have now, including any edits."
        confirmLabel="Rewrite notes"
        icon={Sparkles}
        onConfirm={() => void runGenerateNotes()}
      />
      <ConfirmDialog
        open={confirmOutreach}
        onOpenChange={setConfirmOutreach}
        title="Rewrite the summary and posts?"
        description={`The summary, caption, hashtags and social posts will be replaced with new ones written from your current draft.${isPublic ? " Your published page will show the new summary; the link stays the same." : ""}`}
        confirmLabel="Rewrite"
        icon={Sparkles}
        onConfirm={() => void runGenerateOutreach()}
      />
      <ConfirmDialog
        open={confirmRedesign}
        onOpenChange={setConfirmRedesign}
        title="Redesign your slides?"
        description={`Your current slide outline (${plural(planSlides, "slide")}) will be replaced with a fresh design for about ${slideCount} slides. Existing scene images are reused where possible.`}
        confirmLabel="Redesign slides"
        icon={Wand2}
        onConfirm={() => void runDesignDeck()}
      />
      <ConfirmDialog
        open={confirmUnpublish}
        onOpenChange={setConfirmUnpublish}
        title="Unpublish this sermon?"
        description="The share page will stop working for anyone who has the link. You can publish it again at any time — the link will be the same."
        confirmLabel="Unpublish"
        destructive
        pending={publishJob.pending}
        onConfirm={() => {
          setConfirmUnpublish(false);
          setPublic.mutate(false);
        }}
      />
    </div>
  );
}

function ThemeSwatch({ theme: th, selected, onSelect }: { theme: ExportTheme; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${th.label} theme`}
      onClick={onSelect}
      className={cn(
        "group relative rounded-xl border p-2 text-left transition outline-none focus-visible:ring-3 focus-visible:ring-ring",
        selected ? "border-gold-500/70 bg-gold-400/10 ring-1 ring-gold-400/40" : "border-border bg-surface hover:border-gold-400/50 dark:bg-surface-2/30",
      )}
    >
      <span className="relative block aspect-video overflow-hidden rounded-lg shadow-xs ring-1 ring-black/5" style={{ background: withHash(th.bg) }} aria-hidden>
        <span className="absolute top-[18%] left-[9%] h-[4%] w-[16%] rounded-full" style={{ background: withHash(th.accent) }} />
        <span className="absolute top-[30%] left-[9%] h-[10%] w-[56%] rounded-sm" style={{ background: withHash(th.heading), opacity: 0.92 }} />
        <span className="absolute top-[48%] left-[9%] h-[5%] w-[44%] rounded-sm" style={{ background: withHash(th.textMuted), opacity: 0.85 }} />
        <span className="absolute top-[58%] left-[9%] h-[5%] w-[36%] rounded-sm" style={{ background: withHash(th.textMuted), opacity: 0.6 }} />
        <span className="absolute right-[8%] bottom-[14%] h-[44%] w-[24%] rounded-md" style={{ background: withHash(th.panel) }} />
      </span>
      <span className="mt-2 flex items-center justify-between gap-1 px-0.5">
        <span className="truncate text-[13px] font-medium text-ink">{th.label}</span>
        {selected && (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-gold-500 text-white dark:bg-gold-400 dark:text-navy-900" aria-hidden>
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </span>
    </button>
  );
}

function SlideStrip({ plan, theme }: { plan: SlidePlan; theme: ExportTheme }) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold text-ink-2">Slide outline</p>
        <p className="text-xs text-ink-3">{plural(plan.slides.length, "slide")} · scroll to see them all</p>
      </div>
      <ol className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2" aria-label={`${plan.slides.length} planned slides`} tabIndex={0}>
        {plan.slides.map((s, i) => {
          const img = s.visual?.imageUrl;
          return (
            <li key={i} className="w-40 shrink-0 snap-start sm:w-44">
              <div className="relative aspect-video overflow-hidden rounded-lg border border-border shadow-xs" style={{ background: withHash(theme.bg) }}>
                {img && <img src={img} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />}
                {img && <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" aria-hidden />}
                <span className="absolute top-1.5 left-1.5 rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold text-white">{i + 1}</span>
                <span
                  className="absolute right-2 bottom-1.5 left-2 line-clamp-2 font-serif text-[11px] leading-tight font-semibold"
                  style={{ color: img ? "#F7F5EF" : withHash(theme.heading) }}
                >
                  {s.heading}
                </span>
              </div>
              <p className="mt-1 truncate text-[11px] text-ink-3">
                {LAYOUT_LABEL[s.layout] ?? s.layout}
                {s.visual?.type && VISUAL_LABEL[s.visual.type] ? ` · ${VISUAL_LABEL[s.visual.type]}` : ""}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ExportGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-border px-4 pt-4 last:border-b-0 sm:px-5">
      <h3 className="text-xs font-semibold tracking-[0.12em] text-ink-3 uppercase">{title}</h3>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

function ExportRow({ icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
      <div className="flex min-w-0 items-start gap-3">
        <IconTile icon={icon} />
        <div className="min-w-0">
          <p className="font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{description}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">{children}</div>
    </div>
  );
}

function CopyBlock({ label, icon: Icon, text, serif }: { label: string; icon?: LucideIcon; text: string; serif?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-ink-3 uppercase">
          {Icon && <Icon className="size-3.5" aria-hidden />} {label}
        </span>
        <CopyButton text={text} label="Copy" withText toastMessage={`${label} copied`} />
      </div>
      <div
        className={cn(
          "rounded-xl border border-border bg-paper-2/60 px-3.5 py-3 leading-relaxed whitespace-pre-line text-ink dark:bg-surface-2/30",
          serif ? "font-serif text-[15px]" : "text-sm",
        )}
      >
        {text}
      </div>
    </div>
  );
}
