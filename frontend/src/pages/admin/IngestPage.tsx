import {
  ArrowLeft, ArrowRight, AudioLines, Bot, Building2, Captions, Check, CircleCheck, ClipboardPaste, Clock, ExternalLink, FileText, FileUp, Globe, Layers, Link2,
  ListOrdered, Loader2, Lock, Newspaper, Pencil, PenLine, RotateCcw, Scissors, Search, ShieldCheck, Sparkles, Upload, Video, X, MonitorPlay, type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, ApiError } from "@/api/client";
import { useResourceStatus, useTopics } from "@/api/hooks";
import type { Json, UrlInspection } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { MediaThumb } from "@/components/MediaThumb";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { captionSource, fmtYoutubeDate, looksLikeYoutube, youtubeIdFromUrl } from "@/lib/youtube";
import { fmtTime } from "@/utils/format";
import { uploadWithProgress, useSystemStatus } from "./adminApi";
import {
  ADMIN_PAGE, ChoiceCards, errorMessage, Field, Meter, NativeSelect, Notice, PageHeader, StatusPill, TextArea, TextInput, Toggle, type ChoiceOption,
} from "./AdminUI";
import { CATEGORIES, categoryLabel, fileSize, LANGUAGES, languageLabel, RIGHTS, stageStep, STAGE_ORDER, stageSummary, stageTitle, TRANSCRIPT_MODES, typeLabel, VISIBILITY } from "./adminLabels";

// ───────────────────────────────────────────────────────────── rules (mirror backend ingest/validate.py)

const MB = 1024 * 1024;
const MEDIA_LIMIT = 1024 * MB;
const DOCUMENT_LIMIT = 50 * MB;
const CAPTIONS_LIMIT = 10 * MB;

const EXT_TYPE: Record<string, "video" | "audio" | "pdf" | "document"> = {
  ".mp4": "video", ".mov": "video", ".m4v": "video", ".webm": "video",
  ".mp3": "audio", ".wav": "audio", ".m4a": "audio", ".aac": "audio", ".ogg": "audio", ".flac": "audio",
  ".pdf": "pdf",
  ".docx": "document", ".txt": "document", ".md": "document", ".markdown": "document",
};
const ACCEPT_ALL = Object.keys(EXT_TYPE).join(",");
const ACCEPT_MEDIA = Object.entries(EXT_TYPE).filter(([, t]) => t === "video" || t === "audio").map(([e]) => e).join(",");
const MEDIA_URL_EXT = [".mp4", ".m4v", ".mov", ".webm", ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac"];
const AUDIO_URL_EXT = [".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac"];

const ext = (name: string) => {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
};

function validUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

function parseDuration(value: string): number | null {
  const v = value.trim();
  if (!/^\d{1,3}(:\d{1,2}){0,2}$/.test(v)) return null;
  const seconds = v.split(":").map(Number).reduce((acc, n) => acc * 60 + n, 0);
  return seconds > 0 ? seconds * 1000 : null;
}

function titleFromFile(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : "";
}

// ───────────────────────────────────────────────────────────── draft

type Method = "file" | "youtube" | "link" | "text" | "captions";

interface Draft {
  method: Method | "";
  linkKind: "media" | "article";
  textKind: "native" | "article" | "generated";
  mediaKind: "video" | "audio";
  webmAudio: boolean;
  url: string;
  /** The YouTube video the details below were filled in from. */
  videoId: string;
  duration: string;
  body_text: string;
  generation_source: string;
  generation_model: string;
  title: string;
  category: string;
  categoryTouched: boolean;
  person: string;
  series: string;
  description: string;
  language: string;
  visibility: string;
  rights_status: string;
  allow_clip_export: boolean;
  is_official: boolean;
  requires_review: boolean;
  pii_redaction: boolean;
  transcript_mode: string;
  verse_hints: string;
  topic_hints: string;
}

const EMPTY: Draft = {
  method: "",
  linkKind: "media",
  textKind: "native",
  mediaKind: "video",
  webmAudio: false,
  url: "",
  videoId: "",
  duration: "",
  body_text: "",
  generation_source: "",
  generation_model: "",
  title: "",
  category: "sermon",
  categoryTouched: false,
  person: "",
  series: "",
  description: "",
  language: "en",
  visibility: "public",
  rights_status: "owned",
  allow_clip_export: false,
  is_official: false,
  requires_review: false,
  pii_redaction: true,
  transcript_mode: "auto",
  verse_hints: "",
  topic_hints: "",
};

const DRAFT_KEY = "ibible_admin_ingest_draft_v1";

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = { ...EMPTY, ...(JSON.parse(raw) as Partial<Draft>) };
    return d.method || d.title || d.body_text || d.url ? d : null;
  } catch {
    return null;
  }
}

function saveDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable — drafts are a convenience only */
  }
}

const STEPS = [
  { label: "Source", hint: "What you're adding" },
  { label: "Details", hint: "Title, speaker, language" },
  { label: "Sharing", hint: "Who can see it" },
  { label: "Review", hint: "Check and add" },
] as const;

type Errors = Partial<Record<string, string>>;

type Phase = "create" | "file" | "captions" | "process";

// ───────────────────────────────────────────────────────────── page

export function IngestPage() {
  const { viewer, isEditor } = useAuth();
  const system = useSystemStatus();
  const topics = useTopics();
  const aiOff = system.data ? !system.data.ai?.configured : false;
  const hasOrg = (viewer?.organization_ids || []).length > 0;

  const restored = useMemo(loadDraft, []);
  const [draft, setDraft] = useState<Draft>(restored ?? EMPTY);
  const [showRestored, setShowRestored] = useState(!!restored);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [captions, setCaptions] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<{ file: boolean; captions: boolean }>({ file: false, captions: false });
  const [failure, setFailure] = useState<{ phase: Phase; message: string } | null>(null);
  const [startNow, setStartNow] = useState(true);
  const [saved, setSaved] = useState<{ id: string; processing: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // YouTube link: the video's own details, read before anything is saved
  const [video, setVideo] = useState<UrlInspection | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const checkedUrl = useRef<string>("");
  const prefilled = useRef<Record<string, string>>({});

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  // derived type
  const fileType = file ? EXT_TYPE[ext(file.name)] : undefined;
  const type: string =
    draft.method === "file"
      ? fileType === "video" && ext(file!.name) === ".webm" && draft.webmAudio
        ? "audio"
        : fileType ?? ""
      : draft.method === "youtube"
        ? "video"
        : draft.method === "link"
          ? draft.linkKind === "article"
            ? "article"
            : draft.mediaKind
          : draft.method === "text"
            ? draft.textKind
            : draft.method === "captions"
              ? draft.mediaKind
              : "";
  const media = type === "video" || type === "audio";
  const hosted = draft.method === "youtube"; // stays on YouTube: embed playback, no file export
  const youtube = hosted || (draft.method === "link" && draft.linkKind === "media" && looksLikeYoutube(draft.url));
  const exportAllowed = !hosted && (draft.rights_status === "owned" || draft.rights_status === "licensed");
  const locked = !!createdId; // once the item exists, its details can't change from this form

  /** Read the video's details from YouTube (no download, no AI) and fill in what we can. */
  const checkLink = async (raw?: string) => {
    const url = (raw ?? draft.url).trim();
    if (!url) {
      setCheckError("Paste the link to the YouTube video first.");
      return;
    }
    if (!youtubeIdFromUrl(url)) {
      setVideo(null);
      setCheckError("That doesn't look like a YouTube video link. It should look like youtube.com/watch?v=… or youtu.be/…");
      return;
    }
    checkedUrl.current = url;
    setChecking(true);
    setCheckError(null);
    try {
      const res = await api<UrlInspection>("/v1/resources/inspect-url", { method: "POST", body: { url } });
      checkedUrl.current = res.watch_url || url; // we tidy the link below, so don't check the tidied one again
      setVideo(res);
      setErrors((e) => ({ ...e, url: undefined }));
      setDraft((d) => {
        const next = { ...d, url: res.watch_url || url, videoId: res.video_id };
        // a different video replaces the details it filled in before; re-checking the same one keeps your edits
        const switched = d.videoId !== res.video_id;
        const fill = (key: "title" | "person" | "language" | "category", value?: string | null) => {
          if (!value) return;
          const current = String(next[key] ?? "").trim();
          if (switched || !current || current === (prefilled.current[key] ?? "")) {
            next[key] = value;
            prefilled.current[key] = value;
          }
        };
        fill("title", res.suggested.title);
        fill("person", res.suggested.speaker || res.suggested.author || res.channel || "");
        fill("language", (res.suggested.language || res.language || "en").split("-")[0].toLowerCase());
        if (!d.categoryTouched) fill("category", res.suggested.category);
        next.rights_status = "embed_only";
        next.allow_clip_export = false;
        return next;
      });
    } catch (err) {
      setVideo(null);
      setCheckError(err instanceof ApiError && err.message ? err.message : errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  // paste a link and it is checked for you; a restored draft is checked again on arrival
  useEffect(() => {
    if (draft.method !== "youtube" || locked) return;
    const url = draft.url.trim();
    if (!url || !youtubeIdFromUrl(url) || url === checkedUrl.current) return;
    const t = window.setTimeout(() => void checkLink(url), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.url, draft.method, locked]);

  // switching away from the YouTube source forgets the checked video
  useEffect(() => {
    if (draft.method !== "youtube") {
      setVideo(null);
      setCheckError(null);
      checkedUrl.current = "";
    }
  }, [draft.method]);

  // sensible category default for the kind of content
  useEffect(() => {
    if (draft.categoryTouched || !type) return;
    const suggestion = type === "video" ? "sermon" : type === "audio" ? "podcast" : type === "pdf" || type === "document" ? "study" : type === "article" ? "article" : type === "native" ? "sermon_notes" : "study";
    setDraft((d) => (d.category === suggestion ? d : { ...d, category: suggestion }));
  }, [type, draft.categoryTouched]);

  // autosave everything except files
  useEffect(() => {
    if (locked) return;
    const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY);
    const t = window.setTimeout(() => {
      saveDraft(dirty ? draft : null);
      setSavedAt(dirty ? Date.now() : null);
    }, 500);
    return () => window.clearTimeout(t);
  }, [draft, locked]);

  // don't lose an upload by closing the tab
  useEffect(() => {
    if (!submitting) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [submitting]);

  const goTo = (n: number) => {
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
    window.setTimeout(() => {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 0);
  };

  const validate = (n: number): Errors => {
    const e: Errors = {};
    if (n === 0) {
      if (!draft.method) e.method = "Choose what you're adding.";
      if (draft.method === "file") {
        if (!file) e.file = "Choose a file to upload.";
        else if (!fileType) e.file = ext(file.name) === ".doc" ? "Old Word files (.doc) aren't supported. Save it as .docx first." : "This kind of file isn't supported. See the list of accepted files below.";
        else if (file.size > ((fileType === "video" || fileType === "audio") ? MEDIA_LIMIT : DOCUMENT_LIMIT)) e.file = `This file is ${fileSize(file.size)}. The limit is ${fileType === "video" || fileType === "audio" ? "1 GB for video and audio" : "50 MB for PDFs and documents"}.`;
      }
      if (draft.method === "youtube") {
        if (!draft.url.trim()) e.url = "Paste the link to the YouTube video.";
        else if (!youtubeIdFromUrl(draft.url)) e.url = "That doesn't look like a YouTube video link. It should look like youtube.com/watch?v=… or youtu.be/…";
        else if (checkError) e.url = checkError;
        else if (!video) e.url = checking ? "Still reading the video's details — one moment." : "Check the link so we can read the video's details.";
      }
      if (draft.method === "link") {
        if (!draft.url.trim()) e.url = "Paste a web link.";
        else if (!validUrl(draft.url)) e.url = "That doesn't look like a web link. It should start with https://";
        if (draft.linkKind === "media" && draft.duration.trim() && !parseDuration(draft.duration)) e.duration = "Use minutes and seconds, like 42:10 or 1:05:30.";
      }
      if (draft.method === "text") {
        if (draft.body_text.trim().length < 40) e.body_text = "Paste at least a few sentences so there's something to link to Scripture.";
        if (draft.textKind === "generated" && !draft.generation_source.trim()) e.generation_source = "Say where the text was generated, for example “Study Builder”.";
      }
      if (draft.method === "captions") {
        if (!captions) e.captions = "Choose a captions file (.vtt or .srt).";
        if (file && !["video", "audio"].includes(fileType || "")) e.file = "The recording must be a video or audio file.";
        else if (file && file.size > MEDIA_LIMIT) e.file = `This file is ${fileSize(file.size)}. The limit is 1 GB.`;
      }
      if (captions) {
        if (![".vtt", ".srt"].includes(ext(captions.name))) e.captions = "Captions must be a .vtt or .srt file.";
        else if (captions.size > CAPTIONS_LIMIT) e.captions = "Captions files can be up to 10 MB.";
      }
    }
    if (n === 1) {
      if (!draft.title.trim()) e.title = "Give it a title people will recognise.";
      else if (draft.title.trim().length > 300) e.title = "Keep the title under 300 characters.";
      if (!draft.language.trim()) e.language = "Choose the language, or type its two-letter code.";
      const vague = draft.verse_hints.split(",").map((v) => v.trim()).find((v) => v && !/\d/.test(v));
      if (vague) e.verse_hints = `“${vague}” needs a chapter and verse, like Romans 8:28.`;
    }
    if (n === 2 && draft.visibility === "organization" && !hasOrg) e.visibility = "Your account isn't part of a church or organization yet. Choose another option.";
    if (n === 2 && media && !hosted && draft.method !== "captions" && draft.transcript_mode === "captions" && !captions) e.transcript_mode = "No captions file is attached. Add one in step 1, or choose another option.";
    return e;
  };

  const next = () => {
    // one click does the obvious thing: a pasted YouTube link that hasn't been checked gets checked now
    if (step === 0 && draft.method === "youtube" && !video && !checkError && youtubeIdFromUrl(draft.url) && !checking) {
      void checkLink();
      return;
    }
    const e = validate(step);
    setErrors(e);
    const first = Object.keys(e).find((k) => e[k]);
    if (first) {
      window.setTimeout(() => {
        const el = document.getElementById(`ingest-${first}`);
        const target = el?.matches("input, textarea, select, button") ? el : el?.querySelector<HTMLElement>("input:not([tabindex='-1']), textarea, select, button");
        (target ?? el)?.focus();
      }, 0);
      return;
    }
    goTo(Math.min(step + 1, STEPS.length - 1));
  };

  const jump = (n: number) => {
    if (n <= maxStep && !submitting && !locked) goTo(n);
  };

  const startOver = () => {
    saveDraft(null);
    setDraft(EMPTY);
    setFile(null);
    setCaptions(null);
    setErrors({});
    setShowRestored(false);
    setStep(0);
    setMaxStep(0);
    setVideo(null);
    setCheckError(null);
    checkedUrl.current = "";
    prefilled.current = {};
    setCreatedId(null);
    setUploaded({ file: false, captions: false });
    setFailure(null);
    setSaved(null);
    setStartNow(true);
  };

  const buildBody = (): Json => {
    const hints = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    const body: Json = {
      type,
      title: draft.title.trim(),
      category: draft.category,
      description: draft.description.trim() || null,
      speaker: media ? draft.person.trim() || null : null,
      author: media ? null : draft.person.trim() || null,
      series: draft.series.trim() || null,
      language: draft.language,
      visibility: draft.visibility,
      rights_status: draft.rights_status,
      allow_clip_export: exportAllowed && draft.allow_clip_export,
      is_official: isEditor && draft.is_official,
      requires_review: isEditor && draft.requires_review,
      transcript_mode: draft.method === "captions" ? "captions" : media && !hosted ? draft.transcript_mode : "auto",
      pii_redaction: draft.pii_redaction,
      verse_hints: hints(draft.verse_hints),
      topic_hints: hints(draft.topic_hints),
    };
    if (draft.method === "youtube") {
      // the server reads the video itself: duration, channel and the caption tracks
      body.url = video?.watch_url || draft.url.trim();
      body.rights_status = "embed_only";
      body.allow_clip_export = false;
      if (video?.duration_ms) body.duration_ms = video.duration_ms;
    }
    if (draft.method === "link") body.url = draft.url.trim();
    if (draft.method === "link" && draft.linkKind === "media") {
      const ms = parseDuration(draft.duration);
      if (ms) body.duration_ms = ms;
    }
    if (draft.method === "text") body.body_text = draft.body_text;
    if (type === "generated") body.generation_provenance = { source: draft.generation_source.trim(), model: draft.generation_model.trim() || null, created_by: viewer?.email ?? null };
    return body;
  };

  const submit = async () => {
    for (let i = 0; i < STEPS.length - 1; i++) {
      const e = validate(i);
      if (Object.values(e).some(Boolean)) {
        setErrors(e);
        goTo(i);
        toast.error("Please check this step", { description: Object.values(e).find(Boolean) });
        return;
      }
    }
    setSubmitting(true);
    setFailure(null);
    let current: Phase = "create";
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let id = createdId;
      if (!id) {
        setPhase("create");
        const res = await api<Json>("/v1/resources", { method: "POST", body: buildBody() });
        id = res.id as string;
        setCreatedId(id);
        saveDraft(null);
      }
      const sendFile = draft.method === "file" || draft.method === "captions" ? file : null;
      if (sendFile && !uploaded.file) {
        current = "file";
        setPhase("file");
        setUploadProgress(0);
        const fd = new FormData();
        fd.append("file", sendFile);
        fd.append("kind", "source");
        const up = await uploadWithProgress<Json>(`/v1/resources/${id}/upload`, fd, setUploadProgress, controller.signal);
        (up?.warnings || []).forEach((w: string) => toast.warning(w));
        setUploaded((u) => ({ ...u, file: true }));
      }
      const sendCaptions = media || draft.method === "captions" ? captions : null;
      if (sendCaptions && !uploaded.captions) {
        current = "captions";
        setPhase("captions");
        setUploadProgress(0);
        const fd = new FormData();
        fd.append("file", sendCaptions);
        fd.append("kind", "captions");
        await uploadWithProgress<Json>(`/v1/resources/${id}/upload`, fd, setUploadProgress, controller.signal);
        setUploaded((u) => ({ ...u, captions: true }));
      }
      if (startNow) {
        current = "process";
        setPhase("process");
        await api(`/v1/resources/${id}/process`, { method: "POST", body: {} });
      }
      setPhase(null);
      setSaved({ id, processing: startNow });
      saveDraft(null);
      toast.success("Added to your library", {
        description: startNow ? "Processing has started — you can follow it here." : "Saved. Start processing whenever you're ready.",
      });
      window.setTimeout(() => headingRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      setFailure({ phase: current, message: aborted ? "You cancelled the upload." : errorMessage(err) });
      setPhase(null);
    } finally {
      abortRef.current = null;
      setSubmitting(false);
    }
  };

  const draftLabel = savedAt ? "Draft saved on this device" : null;

  return (
    <div className={cn(ADMIN_PAGE, "max-w-5xl")}>
      <PageHeader
        icon={Upload}
        eyebrow="Library"
        title="Add to library"
        description="Add a sermon, podcast, study or article. It will be split into short sections and linked to the Bible verses it talks about."
      />

      {saved ? (
        <SavedPanel
          id={saved.id}
          processing={saved.processing}
          title={draft.title.trim() || video?.title || "Your new item"}
          thumbnail={video?.thumbnail || null}
          videoId={video?.video_id || youtubeIdFromUrl(draft.url)}
          hosted={hosted}
          transcriptSource={hosted ? captionSource(video ?? {}).kind : null}
          isEditor={isEditor}
          headingRef={headingRef}
          onAddAnother={startOver}
        />
      ) : (
      <>
      {showRestored && !locked && (
        <Notice
          className="mb-5"
          tone="info"
          icon={RotateCcw}
          title="We kept your unfinished draft"
          action={
            <Button variant="outline" onClick={startOver} className="h-10 rounded-xl bg-card px-3.5">
              Start over
            </Button>
          }
        >
          Your typed details are back.{restored?.method === "file" || restored?.method === "captions" ? " Files aren't kept in drafts, so choose the file again." : ""}
        </Notice>
      )}

      <Stepper step={step} maxStep={locked ? -1 : maxStep} onJump={jump} />

      <div className="mt-6 grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <section aria-labelledby="ingest-step-title" className="rounded-2xl border border-border bg-card shadow-xs">
            <header className="border-b border-border px-4 py-4 sm:px-6">
              <p className="text-xs font-semibold tracking-wider text-gold-700 uppercase dark:text-gold-300">
                Step {step + 1} of {STEPS.length}
              </p>
              <h2 id="ingest-step-title" ref={headingRef} tabIndex={-1} className="mt-1 scroll-mt-40 font-display text-2xl font-semibold tracking-tight text-ink outline-none">
                {["What are you adding?", "Tell us about it", "Who can see it?", "Check and add"][step]}
              </h2>
              <p className="mt-1 text-sm text-ink-2">
                {
                  [
                    "Choose how you'd like to add it. You can change this before you finish.",
                    "These details help people find it and show who it's from.",
                    "Decide who can find it, and confirm you have the right to share it.",
                    "Make sure everything looks right. Nothing is added until you press the button below.",
                  ][step]
                }
              </p>
            </header>
            <div className="grid grid-cols-1 gap-6 px-4 py-5 sm:px-6 sm:py-6">
              {step === 0 && (
                <SourceStep
                  draft={draft}
                  set={set}
                  errors={errors}
                  file={file}
                  setFile={(f) => {
                    setFile(f);
                    setErrors((e) => ({ ...e, file: undefined }));
                    if (f && !draft.title.trim()) set("title", titleFromFile(f.name));
                    const kind = f ? EXT_TYPE[ext(f.name)] : undefined;
                    if (draft.method === "captions" && (kind === "video" || kind === "audio")) set("mediaKind", kind);
                  }}
                  captions={captions}
                  setCaptions={(f) => {
                    setCaptions(f);
                    setErrors((e) => ({ ...e, captions: undefined }));
                    if (f && !draft.title.trim() && !file) set("title", titleFromFile(f.name));
                  }}
                  type={type}
                  youtube={youtube}
                  aiOff={aiOff}
                  video={video}
                  checking={checking}
                  checkError={checkError}
                  onCheck={() => void checkLink()}
                />
              )}
              {step === 1 && <DetailsStep draft={draft} set={set} errors={errors} media={media} topics={topics.data || []} video={video} />}
              {step === 2 && (
                <SharingStep
                  draft={draft}
                  set={set}
                  errors={errors}
                  media={media}
                  method={draft.method}
                  youtube={youtube}
                  hosted={hosted}
                  video={video}
                  exportAllowed={exportAllowed}
                  isEditor={isEditor}
                  hasOrg={hasOrg}
                />
              )}
              {step === 3 && (
                <ReviewStep
                  draft={draft}
                  type={type}
                  media={media}
                  file={file}
                  captions={captions}
                  youtube={youtube}
                  hosted={hosted}
                  video={video}
                  aiOff={aiOff}
                  isEditor={isEditor}
                  exportAllowed={exportAllowed}
                  startNow={startNow}
                  setStartNow={setStartNow}
                  onEdit={locked || submitting ? undefined : (n) => goTo(n)}
                />
              )}
            </div>

            {(submitting || failure) && (
              <div className="border-t border-border px-4 py-5 sm:px-6">
                <SubmitProgress
                  phase={phase}
                  failure={failure}
                  progress={uploadProgress}
                  hasFile={!!((draft.method === "file" || draft.method === "captions") && file)}
                  hasCaptions={!!((media || draft.method === "captions") && captions)}
                  fileName={file?.name}
                  createdId={createdId}
                  startsProcessing={startNow}
                  onCancel={phase === "file" || phase === "captions" ? () => abortRef.current?.abort() : undefined}
                />
              </div>
            )}

            <footer className="flex flex-col-reverse gap-3 rounded-b-2xl border-t border-border bg-surface-2/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex items-center gap-3">
                {step > 0 && !locked && (
                  <Button variant="ghost" onClick={() => goTo(step - 1)} disabled={submitting} className="h-11 gap-2 rounded-xl px-4">
                    <ArrowLeft className="size-4" aria-hidden /> Back
                  </Button>
                )}
                {draftLabel && !locked && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-2" aria-live="polite">
                    <Check className="size-3.5 text-ok" aria-hidden /> {draftLabel}
                  </span>
                )}
              </div>
              {step < STEPS.length - 1 ? (
                <Button onClick={next} className="h-11 gap-2 rounded-xl px-5 text-[15px]">
                  Continue <ArrowRight className="size-4" aria-hidden />
                </Button>
              ) : (
                <Button onClick={() => void submit()} disabled={submitting} className="h-11 gap-2 rounded-xl px-5 text-[15px]">
                  {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : failure ? <RotateCcw className="size-4" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                  {submitting ? "Adding…" : failure ? "Try again" : startNow ? "Add to library and start processing" : "Add to library"}
                </Button>
              )}
            </footer>
          </section>
        </div>

        <HowItWorks />
      </div>
      </>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── stepper

function Stepper({ step, maxStep, onJump }: { step: number; maxStep: number; onJump: (n: number) => void }) {
  return (
    <nav aria-label="Steps">
      <div className="sm:hidden">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-semibold text-ink">
            Step {step + 1} of {STEPS.length} · {STEPS[step].label}
          </span>
          <span className="text-ink-2">{STEPS[step].hint}</span>
        </div>
        <Meter value={step + 1} max={STEPS.length} tone="brand" size="sm" label={`Step ${step + 1} of ${STEPS.length}`} />
      </div>
      <ol className="hidden gap-2 sm:grid sm:grid-cols-4">
        {STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step;
          const reachable = i <= maxStep && !current;
          return (
            <li key={s.label}>
              <button
                type="button"
                onClick={() => onJump(i)}
                disabled={!reachable}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-default",
                  current ? "border-gold-500/60 bg-card shadow-xs dark:border-gold-400/60" : "border-transparent",
                  reachable && "hover:bg-card",
                )}
              >
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold",
                    done ? "bg-navy-700 text-white dark:bg-gold-400 dark:text-navy-950" : current ? "bg-gold-400 text-navy-950" : "border border-border bg-surface text-ink-2",
                  )}
                  aria-hidden
                >
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm font-semibold", current || done ? "text-ink" : "text-ink-2")}>{s.label}</span>
                  <span className="block truncate text-xs text-ink-2">{s.hint}</span>
                </span>
                <span className="sr-only">{done ? "(done)" : current ? "(current step)" : ""}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ───────────────────────────────────────────────────────────── step 1: source

const METHOD_OPTIONS: ChoiceOption<Method>[] = [
  { value: "youtube", label: "YouTube link", description: "Paste a YouTube video. It keeps playing from YouTube — nothing is downloaded.", icon: MonitorPlay },
  { value: "file", label: "Upload a file", description: "A video, audio recording, PDF or Word document from this computer.", icon: FileUp },
  { value: "text", label: "Paste text", description: "Sermon notes, a devotional, a study or an article you can copy and paste.", icon: ClipboardPaste },
  { value: "link", label: "Other web link", description: "A direct link to an .mp4 or .mp3 file, or an article on the web.", icon: Link2 },
  { value: "captions", label: "Captions file", description: "A video or audio with its own subtitles (.vtt or .srt) — no AI transcription needed.", icon: Captions },
];

function SourceStep({
  draft,
  set,
  errors,
  file,
  setFile,
  captions,
  setCaptions,
  type,
  youtube,
  aiOff,
  video,
  checking,
  checkError,
  onCheck,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  errors: Errors;
  file: File | null;
  setFile: (f: File | null) => void;
  captions: File | null;
  setCaptions: (f: File | null) => void;
  type: string;
  youtube: boolean;
  aiOff: boolean;
  video: UrlInspection | null;
  checking: boolean;
  checkError: string | null;
  onCheck: () => void;
}) {
  const linkIsMediaFile = MEDIA_URL_EXT.some((e) => draft.url.trim().toLowerCase().split("?")[0].endsWith(e));
  const needsTranscription = (draft.method === "file" && (type === "video" || type === "audio") && !captions) || (draft.method === "link" && draft.linkKind === "media" && !captions);
  return (
    <>
      <div id="ingest-method" tabIndex={-1} className="outline-none">
        <ChoiceCards<Method> name="ingest-method" legend="How are you adding it?" value={draft.method} onChange={(v) => set("method", v)} options={METHOD_OPTIONS} error={errors.method} />
      </div>

      {draft.method === "youtube" && (
        <div className="grid grid-cols-1 gap-4">
          <Field
            label="YouTube link"
            htmlFor="ingest-url"
            error={errors.url ?? checkError}
            hint="Paste the link from the address bar or from YouTube's Share button — youtube.com/watch?v=…, youtu.be/… or a Shorts link."
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <MonitorPlay className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
                <TextInput
                  id="ingest-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://www.youtube.com/watch?v=…"
                  value={draft.url}
                  aria-invalid={!!(errors.url ?? checkError)}
                  aria-describedby={errors.url || checkError ? "ingest-url-error" : "ingest-url-hint"}
                  onChange={(e) => set("url", e.target.value.trim())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onCheck();
                    }
                  }}
                  className="pl-9"
                />
              </div>
              <Button variant="outline" onClick={onCheck} disabled={checking || !draft.url.trim()} className="h-10 shrink-0 gap-2 rounded-xl bg-card px-4">
                {checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
                {checking ? "Reading the video…" : video ? "Check again" : "Check link"}
              </Button>
            </div>
          </Field>

          {checking && !video && (
            <div className="flex animate-pulse gap-4 rounded-2xl border border-border bg-surface-2/40 p-3.5">
              <div className="aspect-video w-36 shrink-0 rounded-xl bg-surface-2 sm:w-44" />
              <div className="min-w-0 flex-1 space-y-2.5 py-1">
                <div className="h-4 w-2/3 rounded bg-surface-2" />
                <div className="h-3 w-1/3 rounded bg-surface-2" />
                <div className="h-3 w-1/2 rounded bg-surface-2" />
              </div>
            </div>
          )}

          {video && !checking && <VideoPreview video={video} />}

          {!video && !checking && !checkError && (
            <Notice tone="info" icon={MonitorPlay} title="What happens with a YouTube link">
              We read the video's own words (its captions) so it can be linked to Scripture. The video itself stays on YouTube and always plays in
              YouTube's player — nothing is downloaded, copied or re-hosted.
            </Notice>
          )}

          {video && aiOff && video.transcript_source === "gemini" && (
            <Notice tone="warn" icon={Bot} title="This video has no captions, and Gemini AI isn't set up">
              Set up Gemini in System &amp; AI first, or choose a video that has captions.
            </Notice>
          )}
        </div>
      )}

      {draft.method === "file" && (
        <div className="grid grid-cols-1 gap-4">
          <FileDrop
            id="ingest-file"
            label="File"
            accept={ACCEPT_ALL}
            file={file}
            onFile={setFile}
            error={errors.file}
            detected={file ? typeLabel(type) || "Unsupported file" : undefined}
            help={
              <ul className="grid grid-cols-1 gap-1 text-[13px] text-ink-2">
                <li><span className="font-medium text-ink">Video</span> — MP4, MOV, M4V, WebM · up to 1 GB</li>
                <li><span className="font-medium text-ink">Audio</span> — MP3, WAV, M4A, AAC, OGG, FLAC · up to 1 GB</li>
                <li><span className="font-medium text-ink">PDF</span> — up to 50 MB</li>
                <li><span className="font-medium text-ink">Documents</span> — Word (.docx), text (.txt), Markdown (.md) · up to 50 MB</li>
              </ul>
            }
          />
          {file && ext(file.name) === ".webm" && (
            <Toggle checked={draft.webmAudio} onChange={(v) => set("webmAudio", v)} label="This WebM file is audio only" description="Turn on if there's no picture, for example a podcast recording." />
          )}
          {(type === "video" || type === "audio") && (
            <CaptionsDrop captions={captions} setCaptions={setCaptions} error={errors.captions} optional />
          )}
        </div>
      )}

      {draft.method === "link" && (
        <div className="grid grid-cols-1 gap-4">
          <ChoiceCards
            name="ingest-link-kind"
            legend="What is the link to?"
            value={draft.linkKind}
            onChange={(v) => set("linkKind", v)}
            options={[
              { value: "media", label: "A video or audio", description: "YouTube, or a direct link to an .mp4 or .mp3 file.", icon: Video },
              { value: "article", label: "An article or web page", description: "The page's text is read and linked to Scripture.", icon: Newspaper },
            ]}
          />
          <Field label="Web link" htmlFor="ingest-url" error={errors.url} hint={draft.linkKind === "media" ? "For example https://www.youtube.com/watch?v=…" : "For example https://example.org/articles/hope-in-hard-times"}>
            <TextInput
              id="ingest-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://"
              value={draft.url}
              aria-invalid={!!errors.url}
              aria-describedby={errors.url ? "ingest-url-error" : "ingest-url-hint"}
              onChange={(e) => {
                set("url", e.target.value);
                const lower = e.target.value.toLowerCase().split("?")[0];
                if (AUDIO_URL_EXT.some((x) => lower.endsWith(x))) set("mediaKind", "audio");
              }}
            />
          </Field>
          {draft.linkKind === "media" && looksLikeYoutube(draft.url) && (
            <Notice
              tone="info"
              icon={MonitorPlay}
              title="That's a YouTube video"
              action={
                <Button variant="outline" onClick={() => set("method", "youtube")} className="h-10 shrink-0 gap-2 rounded-xl bg-card px-3.5">
                  <MonitorPlay className="size-4" aria-hidden /> Use the YouTube link source
                </Button>
              }
            >
              The YouTube source reads the video's details and captions for you, and keeps playback in YouTube's player.
            </Notice>
          )}
          {draft.linkKind === "media" && draft.url.trim() && validUrl(draft.url) && !youtube && !linkIsMediaFile && (
            <Notice tone="warn" title="This doesn't look like a media file">
              Links to web pages that only contain a player usually can't be processed. Use a link ending in .mp4 or .mp3, add a captions file below, or
              paste a YouTube link with the YouTube source.
            </Notice>
          )}
          {draft.linkKind === "media" && (
            <>
              {!youtube && (
                <ChoiceCards
                  name="ingest-media-kind"
                  legend="Is it video or audio?"
                  value={draft.mediaKind}
                  onChange={(v) => set("mediaKind", v)}
                  options={[
                    { value: "video", label: "Video", icon: Video },
                    { value: "audio", label: "Audio only", icon: AudioLines },
                  ]}
                />
              )}
              <Field
                label="Length"
                htmlFor="ingest-duration"
                optional
                error={errors.duration}
                hint={youtube ? "Recommended for YouTube — it lets transcription work through the video in accurate time windows. Use minutes:seconds, like 42:10." : "Minutes:seconds, like 42:10."}
              >
                <div className="relative sm:max-w-44">
                  <Clock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
                  <TextInput id="ingest-duration" inputMode="numeric" placeholder="e.g. 42:10" value={draft.duration} aria-invalid={!!errors.duration} onChange={(e) => set("duration", e.target.value)} className="pl-9" />
                </div>
              </Field>
              <CaptionsDrop captions={captions} setCaptions={setCaptions} error={errors.captions} optional />
            </>
          )}
        </div>
      )}

      {draft.method === "text" && (
        <div className="grid grid-cols-1 gap-4">
          <ChoiceCards
            name="ingest-text-kind"
            legend="What kind of text is it?"
            value={draft.textKind}
            onChange={(v) => set("textKind", v)}
            columns={3}
            options={[
              { value: "native", label: "My own writing", description: "Sermon notes, a devotional or a study.", icon: PenLine },
              { value: "article", label: "An article", description: "Written by someone else.", icon: Newspaper },
              { value: "generated", label: "AI-generated", description: "Text created with an AI tool.", icon: Sparkles },
            ]}
          />
          <Field
            label="Text"
            htmlFor="ingest-body_text"
            error={errors.body_text}
            hint={
              <span className="flex flex-wrap justify-between gap-2">
                <span>Headings and lists in Markdown are kept.</span>
                <span className="tabular-nums">{wordCount(draft.body_text).toLocaleString()} words</span>
              </span>
            }
          >
            <TextArea
              id="ingest-body_text"
              value={draft.body_text}
              onChange={(e) => set("body_text", e.target.value)}
              aria-invalid={!!errors.body_text}
              placeholder="Paste or type the text here…"
              className="min-h-64 font-serif text-[16px] leading-relaxed"
            />
          </Field>
          {draft.textKind === "generated" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Where was it generated?" htmlFor="ingest-generation_source" error={errors.generation_source} hint="The tool or feature that produced it.">
                <TextInput id="ingest-generation_source" value={draft.generation_source} onChange={(e) => set("generation_source", e.target.value)} aria-invalid={!!errors.generation_source} placeholder="e.g. Study Builder" />
              </Field>
              <Field label="AI model" htmlFor="ingest-generation_model" optional>
                <TextInput id="ingest-generation_model" value={draft.generation_model} onChange={(e) => set("generation_model", e.target.value)} placeholder="e.g. gemini-flash" />
              </Field>
            </div>
          )}
        </div>
      )}

      {draft.method === "captions" && (
        <div className="grid grid-cols-1 gap-4">
          <ChoiceCards
            name="ingest-captions-kind"
            legend="Are the captions for a video or audio?"
            value={draft.mediaKind}
            onChange={(v) => set("mediaKind", v)}
            options={[
              { value: "video", label: "Video", icon: Video },
              { value: "audio", label: "Audio only", icon: AudioLines },
            ]}
          />
          <CaptionsDrop captions={captions} setCaptions={setCaptions} error={errors.captions} />
          <FileDrop
            id="ingest-file"
            label="The recording"
            optional
            accept={ACCEPT_MEDIA}
            file={file}
            onFile={setFile}
            error={errors.file}
            detected={file ? typeLabel(EXT_TYPE[ext(file.name)] || "") || "Unsupported file" : undefined}
            help={<p className="text-[13px] text-ink-2">Add the video or audio too so people can watch or listen to the clips. Without it, verse links still work but nothing plays.</p>}
          />
        </div>
      )}

      {aiOff && needsTranscription && (
        <Notice tone="warn" icon={Bot} title="Transcription needs Gemini AI, which isn't set up">
          Add a captions file (.vtt or .srt) so the words can be read without AI, or set up Gemini in System & AI first.
        </Notice>
      )}
    </>
  );
}

/** The video we found, before anything is saved: still, title, channel, length and where the words will come from. */
function VideoPreview({ video, className }: { video: UrlInspection; className?: string }) {
  const source = captionSource(video);
  const published = fmtYoutubeDate(video.upload_date);
  const chapters = video.chapters?.length ?? 0;
  const band = {
    ok: "bg-ok-soft text-ok",
    info: "bg-accent-soft text-link",
    warn: "bg-warn-soft text-warn",
  }[source.tone];
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-border bg-card shadow-xs", className)} aria-label="The video we found">
      <div className="flex flex-col gap-4 p-3.5 sm:flex-row sm:p-4">
        <MediaThumb
          src={video.thumbnail}
          videoId={video.video_id}
          alt={`Still from “${video.title}”`}
          time={fmtTime(video.duration_ms)}
          youtube
          badgeSize="lg"
          className="aspect-video w-full sm:w-52"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-gold-700 uppercase dark:text-gold-300">Found on YouTube</p>
          <h3 className="mt-1 font-display text-[17px] leading-snug font-semibold text-ink">{video.title}</h3>
          <p className="mt-1.5 text-[13px] text-ink-2">
            {[video.channel, video.duration_ms ? fmtTime(video.duration_ms) : null, published].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {chapters > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11.5px] font-medium text-ink-2 dark:bg-white/[0.06]">
                <ListOrdered className="size-3.5" aria-hidden /> {chapters} chapter{chapters === 1 ? "" : "s"}
              </span>
            )}
            {video.language && (
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11.5px] font-medium text-ink-2 uppercase dark:bg-white/[0.06]">{video.language.split("-")[0]}</span>
            )}
            <a
              href={video.watch_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[12.5px] font-semibold text-link no-underline hover:underline"
            >
              <ExternalLink className="size-3.5" aria-hidden /> Open on YouTube
            </a>
          </div>
        </div>
      </div>
      <div className={cn("border-t border-border px-3.5 py-3 sm:px-4", band)}>
        <p className="flex items-center gap-2 text-[13px] font-semibold">
          {source.kind === "gemini" ? <Bot className="size-4 shrink-0" aria-hidden /> : <Captions className="size-4 shrink-0" aria-hidden />}
          {source.label}
        </p>
        <p className="mt-0.5 text-[13px]/relaxed">{source.detail}</p>
      </div>
    </section>
  );
}

function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function FileDrop({
  id,
  label,
  accept,
  file,
  onFile,
  error,
  help,
  detected,
  optional,
}: {
  id: string;
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  error?: string;
  help?: ReactNode;
  detected?: string;
  optional?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };
  const Icon: LucideIcon = file ? (detected === "Video" ? Video : detected === "Audio" ? AudioLines : FileText) : Upload;
  return (
    <Field label={label} htmlFor={id} error={error} optional={optional}>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          onFile(e.target.files?.[0] || null);
          e.target.value = "";
        }}
      />
      {file ? (
        <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border bg-surface p-3 dark:bg-surface-2/40", error ? "border-danger" : "border-border")}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-400/15 text-gold-700 dark:text-gold-300" aria-hidden>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{file.name}</p>
            <p className="text-xs text-ink-2">
              {fileSize(file.size)}
              {detected && ` · ${detected}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button id={id} variant="outline" onClick={() => input.current?.click()} className="h-10 rounded-xl bg-card px-3.5" aria-invalid={!!error}>
              Change
            </Button>
            <Button variant="ghost" onClick={() => onFile(null)} className="h-10 w-10 rounded-xl p-0" aria-label={`Remove ${file.name}`}>
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center rounded-2xl border-2 border-dashed px-4 py-7 text-center transition",
            over ? "border-gold-500 bg-gold-400/10" : error ? "border-danger/60 bg-[var(--danger-soft)]/40" : "border-border bg-surface-2/30",
          )}
        >
          <span className="grid size-12 place-items-center rounded-full bg-gold-400/15 text-gold-700 dark:text-gold-300" aria-hidden>
            <Upload className="size-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-ink">Drag a file here, or</p>
          <Button id={id} onClick={() => input.current?.click()} className="mt-2 h-10 gap-2 rounded-xl px-4" aria-invalid={!!error}>
            <FileUp className="size-4" aria-hidden /> Choose a file
          </Button>
        </div>
      )}
      {help && <div className="mt-3">{help}</div>}
    </Field>
  );
}

function CaptionsDrop({ captions, setCaptions, error, optional }: { captions: File | null; setCaptions: (f: File | null) => void; error?: string; optional?: boolean }) {
  return (
    <FileDrop
      id="ingest-captions"
      label="Captions file"
      optional={optional}
      accept=".vtt,.srt"
      file={captions}
      onFile={setCaptions}
      error={error}
      detected={captions ? "Captions" : undefined}
      help={
        <p className="text-[13px] leading-relaxed text-ink-2">
          {optional ? "Have subtitles already? Add them to skip AI transcription — it's faster and free. " : ""}WebVTT (.vtt) or SubRip (.srt), up to 10 MB.
        </p>
      }
    />
  );
}

// ───────────────────────────────────────────────────────────── step 2: details

function DetailsStep({
  draft,
  set,
  errors,
  media,
  topics,
  video,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  errors: Errors;
  media: boolean;
  topics: Json[];
  video: UrlInspection | null;
}) {
  const knownLanguage = LANGUAGES.some(([c]) => c === draft.language);
  const [otherLanguage, setOtherLanguage] = useState(!knownLanguage);
  const endsWithSeparator = /,\s*$/.test(draft.topic_hints) || !draft.topic_hints.trim();
  const lastToken = endsWithSeparator ? "" : (draft.topic_hints.split(",").pop() ?? "").trim().toLowerCase();
  const chosen = new Set(draft.topic_hints.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean));
  const suggestions = [...topics]
    .filter((t) => !chosen.has(String(t.name).toLowerCase()) && (!lastToken || String(t.name).toLowerCase().includes(lastToken) || (t.aliases || []).some((a: string) => a.includes(lastToken))))
    .sort((a, b) => Number(b.usage || 0) - Number(a.usage || 0))
    .slice(0, 8);
  const addTopic = (name: string) => {
    const parts = draft.topic_hints.split(",").map((t) => t.trim()).filter(Boolean);
    if (lastToken && parts.length) parts.pop(); // replace the word being typed with the chosen topic
    set("topic_hints", [...parts, name].join(", ") + ", ");
    document.getElementById("ingest-topic_hints")?.focus();
  };
  const verseWarnings = draft.verse_hints
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v && !/\d/.test(v));

  return (
    <>
      {video && draft.method === "youtube" && (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-2/40 p-3">
          <MediaThumb src={video.thumbnail} videoId={video.video_id} alt="" time={fmtTime(video.duration_ms)} youtube badgeSize="sm" className="aspect-video w-24 shrink-0 sm:w-28" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{video.title}</p>
            <p className="truncate text-[13px] text-ink-2">{video.channel}</p>
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-[11.5px] font-medium text-ink-2 shadow-xs sm:inline-flex">
            <Sparkles className="size-3.5 text-gold-600 dark:text-gold-300" aria-hidden /> Filled in from YouTube
          </span>
        </div>
      )}

      <Field label="Title" htmlFor="ingest-title" error={errors.title} hint="Shown in the library and on verse pages.">
        <TextInput id="ingest-title" value={draft.title} maxLength={300} onChange={(e) => set("title", e.target.value)} aria-invalid={!!errors.title} placeholder={media ? "e.g. All Things for Good" : "e.g. Peace for Anxious Hearts"} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Kind of content" htmlFor="ingest-category">
          <NativeSelect
            id="ingest-category"
            value={draft.category}
            onChange={(e) => {
              set("category", e.target.value);
              set("categoryTouched", true);
            }}
          >
            {CATEGORIES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={media ? "Speaker" : "Author"} htmlFor="ingest-person" optional>
          <TextInput id="ingest-person" value={draft.person} onChange={(e) => set("person", e.target.value)} placeholder={media ? "e.g. Pastor Elena Brooks" : "e.g. Clara Whitfield"} autoComplete="name" />
        </Field>
        <Field label="Language" htmlFor="ingest-language" error={errors.language} hint={media ? "The language spoken in the recording." : undefined}>
          <NativeSelect
            id="ingest-language"
            value={otherLanguage ? "__other" : draft.language}
            onChange={(e) => {
              if (e.target.value === "__other") {
                setOtherLanguage(true);
                set("language", "");
              } else {
                setOtherLanguage(false);
                set("language", e.target.value);
              }
            }}
          >
            {LANGUAGES.map(([c, l]) => (
              <option key={c} value={c}>{l}</option>
            ))}
            <option value="__other">Other…</option>
          </NativeSelect>
          {otherLanguage && (
            <TextInput
              className="mt-2"
              aria-label="Language code"
              placeholder="Two-letter code, for example ko"
              maxLength={8}
              value={draft.language}
              onChange={(e) => set("language", e.target.value.trim().toLowerCase())}
              onBlur={() => !draft.language && (setOtherLanguage(false), set("language", "en"))}
            />
          )}
        </Field>
        <Field label="Series" htmlFor="ingest-series" optional>
          <TextInput id="ingest-series" value={draft.series} onChange={(e) => set("series", e.target.value)} placeholder="e.g. Hope in Hard Times" />
        </Field>
      </div>

      <Field label="Short description" htmlFor="ingest-description" optional hint="One or two sentences about what it covers.">
        <TextArea id="ingest-description" value={draft.description} onChange={(e) => set("description", e.target.value)} className="min-h-20" />
      </Field>

      <div className="rounded-2xl border border-border bg-surface-2/40 p-4 sm:p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkles className="size-4 text-gold-600 dark:text-gold-300" aria-hidden /> Help it find Scripture <span className="text-xs font-normal text-ink-2">Optional</span>
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">If you already know verses or topics it covers, list them. They're used as hints — every one is still checked against the content.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Bible verses"
            htmlFor="ingest-verse_hints"
            hint="Separate with commas, and include chapter and verse."
            error={errors.verse_hints ?? (verseWarnings.length ? `“${verseWarnings[0]}” needs a chapter and verse, like Romans 8:28.` : null)}
          >
            <TextInput id="ingest-verse_hints" value={draft.verse_hints} onChange={(e) => set("verse_hints", e.target.value)} placeholder="e.g. Romans 8:28, Genesis 50:20" aria-invalid={verseWarnings.length > 0} />
          </Field>
          <Field label="Topics" htmlFor="ingest-topic_hints" hint="Separate with commas.">
            <TextInput id="ingest-topic_hints" value={draft.topic_hints} onChange={(e) => set("topic_hints", e.target.value)} placeholder="e.g. hope, suffering" />
          </Field>
        </div>
        {suggestions.length > 0 && (
          <div className="mt-3">
            <p className="mb-2 text-xs font-medium text-ink-2">{lastToken ? "Matching topics" : "Popular topics"}</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => addTopic(t.name)}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border bg-card px-3 text-[13px] font-medium text-ink-2 transition hover:border-gold-400/60 hover:text-ink focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                >
                  + {t.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────── step 3: sharing

const VISIBILITY_ICONS: Record<string, LucideIcon> = { public: Globe, organization: Building2, unlisted: Link2, private: Lock };

function SharingStep({
  draft,
  set,
  errors,
  media,
  method,
  youtube,
  hosted,
  video,
  exportAllowed,
  isEditor,
  hasOrg,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  errors: Errors;
  media: boolean;
  method: Method | "";
  youtube: boolean;
  hosted: boolean;
  video: UrlInspection | null;
  exportAllowed: boolean;
  isEditor: boolean;
  hasOrg: boolean;
}) {
  return (
    <>
      <div id="ingest-visibility" tabIndex={-1} className="outline-none">
        <ChoiceCards
          name="ingest-visibility"
          legend="Who can find it?"
          value={draft.visibility}
          onChange={(v) => set("visibility", v)}
          error={errors.visibility}
          options={Object.entries(VISIBILITY).map(([value, v]) => ({
            value,
            label: v.label,
            description: value === "organization" && !hasOrg ? "Not available — your account isn't part of a church or organization." : v.description,
            icon: VISIBILITY_ICONS[value],
            badge: value === "public" ? <span className="rounded-full bg-gold-400/20 px-2 py-0.5 text-[11px] font-semibold text-gold-700 dark:text-gold-300">Most common</span> : undefined,
          }))}
        />
      </div>

      {hosted ? (
        <section className="rounded-2xl border border-border bg-surface-2/40 p-4 sm:p-5" aria-labelledby="ingest-hosted-rights">
          <h3 id="ingest-hosted-rights" className="flex items-center gap-2 font-display text-[17px] font-semibold text-ink">
            <MonitorPlay className="size-5 text-gold-700 dark:text-gold-300" aria-hidden /> This video stays on YouTube
          </h3>
          <p className="mt-1 text-sm/relaxed text-ink-2">
            Nothing is copied or re-hosted, so there's no rights question to answer — we only keep the words so they can be linked to Scripture.
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-2 text-sm text-ink-2">
            {[
              { icon: Video, text: "Playback is always YouTube's own player, with their ads and their view count." },
              { icon: Captions, text: video?.transcript_source === "gemini" ? "The words come from AI transcription — kept in your library, not the video." : "Only the video's captions are stored in your library." },
              { icon: ShieldCheck, text: "Recorded as “Embedded playback only”." },
              { icon: Scissors, text: "Verse clips are just a start and end time, so clip files can't be downloaded." },
            ].map((i) => (
              <li key={i.text} className="flex gap-2.5">
                <i.icon className="mt-0.5 size-4 shrink-0 text-gold-700 dark:text-gold-300" aria-hidden />
                <span>{i.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          <ChoiceCards
            name="ingest-rights"
            legend="Do you have the right to share it?"
            value={draft.rights_status}
            onChange={(v) => set("rights_status", v)}
            options={Object.entries(RIGHTS).map(([value, v]) => ({ value, label: v.label, description: v.description }))}
          />
          {youtube && draft.rights_status !== "embed_only" && (
            <Notice tone="info" title="Is this someone else's YouTube video?">
              Choose “Embedded playback only” so it plays in YouTube's own player.
            </Notice>
          )}
        </div>
      )}

      {media && !hosted && method !== "captions" && (
        <Field label="Transcript" htmlFor="ingest-transcript_mode" error={errors.transcript_mode} hint={TRANSCRIPT_MODES[draft.transcript_mode]?.description}>
          <NativeSelect id="ingest-transcript_mode" value={draft.transcript_mode} onChange={(e) => set("transcript_mode", e.target.value)}>
            {Object.entries(TRANSCRIPT_MODES).map(([v, m]) => (
              <option key={v} value={v}>{m.label}</option>
            ))}
          </NativeSelect>
        </Field>
      )}

      <fieldset className="grid grid-cols-1 gap-4 rounded-2xl border border-border p-4 sm:p-5">
        <legend className="px-1 text-[13px] font-semibold text-ink">Options</legend>
        {media && !hosted && (
          <Toggle
            checked={draft.allow_clip_export && exportAllowed}
            disabled={!exportAllowed}
            onChange={(v) => set("allow_clip_export", v)}
            label="Allow clip downloads"
            description={exportAllowed ? "People can download short clips as video or audio files." : "Only possible when you own or license it."}
          />
        )}
        <Toggle checked={draft.pii_redaction} onChange={(v) => set("pii_redaction", v)} label="Hide email addresses and phone numbers" description="Removes them from transcripts and text before anything is shown." />
        {isEditor && (
          <>
            <Toggle
              checked={draft.is_official}
              onChange={(v) => set("is_official", v)}
              label="Official church content"
              description="Marks it as your church's own teaching. Its verse links wait for your approval before readers see them."
            />
            <Toggle
              checked={draft.requires_review}
              onChange={(v) => set("requires_review", v)}
              label="Approve every verse link myself"
              description="Nothing from this item is shown to readers until you approve it in the Review queue."
            />
          </>
        )}
      </fieldset>
    </>
  );
}

// ───────────────────────────────────────────────────────────── step 4: review

function SummaryGroup({ title, step, onEdit, children }: { title: string; step: number; onEdit?: (n: number) => void; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-[17px] font-semibold text-ink">{title}</h3>
        {onEdit && (
          <Button variant="ghost" onClick={() => onEdit(step)} className="h-10 gap-1.5 rounded-xl px-3 text-link">
            <Pencil className="size-3.5" aria-hidden /> Change<span className="sr-only"> {title.toLowerCase()}</span>
          </Button>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="font-medium text-ink-2">{label}</dt>
      <dd className="mb-1.5 min-w-0 break-words text-ink sm:mb-0">{children}</dd>
    </div>
  );
}

function ReviewStep({
  draft,
  type,
  media,
  file,
  captions,
  youtube,
  hosted,
  video,
  aiOff,
  isEditor,
  exportAllowed,
  startNow,
  setStartNow,
  onEdit,
}: {
  draft: Draft;
  type: string;
  media: boolean;
  file: File | null;
  captions: File | null;
  youtube: boolean;
  hosted: boolean;
  video: UrlInspection | null;
  aiOff: boolean;
  isEditor: boolean;
  exportAllowed: boolean;
  startNow: boolean;
  setStartNow: (v: boolean) => void;
  onEdit?: (n: number) => void;
}) {
  const how = { file: "Upload a file", youtube: "YouTube link", link: "Web link", text: "Pasted text", captions: "Captions file" }[draft.method || "file"];
  const options = [
    media && exportAllowed && draft.allow_clip_export ? "Clip downloads allowed" : null,
    draft.pii_redaction ? "Emails and phone numbers hidden" : null,
    isEditor && draft.is_official ? "Official church content" : null,
    isEditor && draft.requires_review ? "Every verse link needs your approval" : null,
  ].filter(Boolean);
  const hasCaptions = draft.method === "captions" || (media && !!captions);
  const usesCaptions = draft.method === "captions" || (hasCaptions && draft.transcript_mode !== "gemini");
  const source = hosted ? captionSource(video ?? {}) : null;
  const transcript = !media
    ? null
    : hosted
      ? source!.label
      : usesCaptions
        ? "From your captions file"
        : draft.transcript_mode === "captions"
          ? "Captions only — but no captions file is attached"
          : `${youtube ? "AI transcription of the YouTube video" : "AI transcription"}${hasCaptions ? " (captions attached but not used)" : ""}`;
  return (
    <>
      {hosted && video && <VideoPreview video={video} />}

      <SummaryGroup title="Source" step={0} onEdit={onEdit}>
        <Row label="Adding">{how}</Row>
        <Row label="Type">{typeLabel(type)}</Row>
        {file && (draft.method === "file" || draft.method === "captions") && (
          <Row label="File">
            {file.name} <span className="text-ink-2">· {fileSize(file.size)}</span>
          </Row>
        )}
        {captions && (media || draft.method === "captions") && (
          <Row label="Captions">
            {captions.name} <span className="text-ink-2">· {fileSize(captions.size)}</span>
          </Row>
        )}
        {hosted && video && (
          <>
            <Row label="Video">
              {video.title} <span className="text-ink-2">· {video.channel}</span>
            </Row>
            <Row label="Length">{fmtTime(video.duration_ms)}</Row>
            {(video.chapters?.length ?? 0) > 0 && <Row label="Chapters">{video.chapters.length} in this video</Row>}
            <Row label="Link">
              <a href={video.watch_url} target="_blank" rel="noreferrer" className="font-medium text-link">
                {video.watch_url}
              </a>
            </Row>
          </>
        )}
        {draft.method === "link" && <Row label="Link">{draft.url}</Row>}
        {draft.method === "link" && draft.linkKind === "media" && draft.duration && <Row label="Length">{draft.duration}</Row>}
        {draft.method === "text" && <Row label="Text">{wordCount(draft.body_text).toLocaleString()} words</Row>}
        {draft.textKind === "generated" && draft.method === "text" && <Row label="Generated with">{[draft.generation_source, draft.generation_model].filter(Boolean).join(" · ")}</Row>}
        {transcript && <Row label="Transcript">{transcript}</Row>}
      </SummaryGroup>

      <SummaryGroup title="Details" step={1} onEdit={onEdit}>
        <Row label="Title">{draft.title || <span className="text-danger">Missing</span>}</Row>
        <Row label="Kind">{categoryLabel(draft.category)}</Row>
        {draft.person && <Row label={media ? "Speaker" : "Author"}>{draft.person}</Row>}
        {draft.series && <Row label="Series">{draft.series}</Row>}
        <Row label="Language">{languageLabel(draft.language)}</Row>
        {draft.description && <Row label="Description">{draft.description}</Row>}
        {draft.verse_hints.trim() && <Row label="Verse hints">{draft.verse_hints.replace(/,\s*$/, "")}</Row>}
        {draft.topic_hints.trim() && <Row label="Topic hints">{draft.topic_hints.replace(/,\s*$/, "")}</Row>}
      </SummaryGroup>

      <SummaryGroup title="Sharing" step={2} onEdit={onEdit}>
        <Row label="Who can find it">
          <span className="font-medium">{VISIBILITY[draft.visibility]?.label}</span> <span className="text-ink-2">— {VISIBILITY[draft.visibility]?.description}</span>
        </Row>
        <Row label="Rights">
          <span className="font-medium">{RIGHTS[draft.rights_status]?.label}</span> <span className="text-ink-2">— {RIGHTS[draft.rights_status]?.description}</span>
        </Row>
        {options.length > 0 && <Row label="Options">{options.join(" · ")}</Row>}
      </SummaryGroup>

      <div className="rounded-2xl border border-gold-500/30 bg-gold-400/10 p-4 sm:p-5">
        <h3 className="flex items-center gap-2 font-display text-[17px] font-semibold text-ink">
          <ShieldCheck className="size-5 text-gold-700 dark:text-gold-300" aria-hidden /> What happens next
        </h3>
        {hosted ? (
          <ol className="mt-3 grid grid-cols-1 gap-2.5 text-sm leading-relaxed text-ink-2">
            <NextStep n={1}>
              {source!.kind === "gemini"
                ? "Gemini listens to the video on YouTube and writes out what is said."
                : source!.kind === "manual"
                  ? "The video's human-made captions are read straight from YouTube."
                  : "The video's automatic captions are read straight from YouTube."}
            </NextStep>
            <NextStep n={2}>The words are split into short sections, each about one idea.</NextStep>
            <NextStep n={3}>Every section is linked to the Bible verses it mentions, quotes or talks about.</NextStep>
            <NextStep n={4}>
              Each verse link gets a <span className="font-medium text-ink">verse clip</span> — the moment to play in the YouTube player. Confident links
              go live; anything uncertain waits for you in the Review queue.
            </NextStep>
          </ol>
        ) : (
          <ol className="mt-3 grid grid-cols-1 gap-2.5 text-sm leading-relaxed text-ink-2">
            {(file || captions) && <NextStep n={1}>Your {file ? "file is" : "captions are"} uploaded. Large recordings can take a few minutes — keep this tab open until it finishes.</NextStep>}
            <NextStep n={file || captions ? 2 : 1}>
              It's {media ? (usesCaptions ? "read from your captions" : "transcribed") : "read"}, split into short sections, and each section is linked to the Bible verses it talks about.
            </NextStep>
            <NextStep n={file || captions ? 3 : 2}>Confident links are shown to readers. Links it isn't sure about wait for you in the Review queue.</NextStep>
          </ol>
        )}
        <p className="mt-3 flex items-start gap-2 text-sm text-ink-2">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {hosted
              ? source!.kind === "gemini"
                ? "Roughly 5–15 minutes for a long service, because the whole video has to be transcribed by AI first. It costs AI credits — a few cents for a short video, more for a long one."
                : `Usually ${(video?.duration_ms ?? 0) > 45 * 60_000 ? "3–8" : "1–5"} minutes — reading captions is quick and free, and finding the verse links is the slower part.`
              : "Usually 1–5 minutes. It uses Gemini AI — typically a few cents per item, a little more for long recordings."}{" "}
            {aiOff ? "Gemini AI isn't set up, so only the non-AI steps will run. " : ""}You can follow progress here or in the Processing monitor.
          </span>
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface-2/40 p-4 sm:p-5">
        <Toggle
          checked={startNow}
          onChange={setStartNow}
          label="Start processing as soon as it's added"
          description={
            startNow
              ? "Recommended — you'll see live progress on the next screen and can leave the page at any time."
              : "It will be saved to your library and wait. You can start it whenever you're ready."
          }
        />
      </div>
    </>
  );
}

function NextStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-card text-xs font-semibold text-ink shadow-xs" aria-hidden>
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

// ───────────────────────────────────────────────────────────── submit progress

function SubmitProgress({
  phase,
  failure,
  progress,
  hasFile,
  hasCaptions,
  fileName,
  createdId,
  startsProcessing = true,
  onCancel,
}: {
  phase: Phase | null;
  failure: { phase: Phase; message: string } | null;
  progress: number | null;
  hasFile: boolean;
  hasCaptions: boolean;
  fileName?: string;
  createdId: string | null;
  startsProcessing?: boolean;
  onCancel?: () => void;
}) {
  const steps: { key: Phase; label: string }[] = [
    { key: "create", label: "Saving the details" },
    ...(hasFile ? [{ key: "file" as Phase, label: `Uploading ${fileName ?? "the file"}` }] : []),
    ...(hasCaptions ? [{ key: "captions" as Phase, label: "Uploading captions" }] : []),
    ...(startsProcessing ? [{ key: "process" as Phase, label: "Starting processing" }] : []),
  ];
  const order = steps.map((s) => s.key);
  const currentIndex = failure ? order.indexOf(failure.phase) : phase ? order.indexOf(phase) : -1;
  return (
    <div aria-live="polite">
      <ol className="grid grid-cols-1 gap-3">
        {steps.map((s, i) => {
          const done = i < currentIndex || (!failure && !phase && createdId !== null && i < order.length);
          const current = i === currentIndex;
          const failed = !!failure && current;
          const uploading = current && !failure && (s.key === "file" || s.key === "captions");
          return (
            <li key={s.key} className="flex items-start gap-3">
              <span className="mt-0.5 grid grid-cols-1 size-5 shrink-0 place-items-center" aria-hidden>
                {failed ? <X className="size-5 text-danger" /> : done ? <CircleCheck className="size-5 text-ok" /> : current ? <Loader2 className="size-5 animate-spin text-link" /> : <span className="size-3 rounded-full border-2 border-input" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm", current || done ? "font-semibold text-ink" : "text-ink-2")}>{s.label}</p>
                {uploading && (
                  <div className="mt-2 flex items-center gap-3">
                    {progress == null ? (
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--accent-2)]" />
                      </div>
                    ) : (
                      <Meter value={progress} tone="info" label={`Upload ${Math.round(progress * 100)}% complete`} />
                    )}
                    <span className="w-10 text-right text-sm font-semibold text-ink tabular-nums">{progress == null ? "" : `${Math.round(progress * 100)}%`}</span>
                    {onCancel && (
                      <Button variant="outline" onClick={onCancel} className="h-9 rounded-lg px-3">
                        Cancel
                      </Button>
                    )}
                  </div>
                )}
                {failed && <p className="mt-1 text-sm break-words text-danger">{failure?.message}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {failure && createdId && (
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          Your item was saved as a draft, so nothing is lost. Press <strong className="text-ink">Try again</strong> to finish, or{" "}
          <Link to={`/admin/resources/${createdId}`} className="font-semibold text-link">
            open the draft
          </Link>{" "}
          to delete it.
        </p>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── after it's added

/** What the owner sees once the item exists: live processing progress, then the way into it. */
function SavedPanel({
  id,
  processing,
  title,
  thumbnail,
  videoId,
  hosted,
  transcriptSource,
  isEditor,
  headingRef,
  onAddAnother,
}: {
  id: string;
  processing: boolean;
  title: string;
  thumbnail: string | null;
  videoId: string | null;
  hosted: boolean;
  transcriptSource: "manual" | "auto" | "gemini" | null;
  isEditor: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onAddAnother: () => void;
}) {
  const [started, setStarted] = useState(processing);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(processing);
  const status = useResourceStatus(id, polling);
  const st = status.data as Json | undefined;
  const run = st?.run as Json | undefined;
  const state = String(st?.status ?? (started ? "queued" : "ready"));
  const active = ["queued", "processing"].includes(state);
  const ready = state === "processed";
  const failed = state === "failed" || run?.status === "failed";
  const progress = Math.round(Number(st?.progress ?? 0) * 100);
  const step = stageStep(run?.current_stage);
  const visible = Number(st?.counts?.visible ?? 0);
  const inReview = Number(st?.counts?.in_review ?? 0);

  useEffect(() => {
    if (state === "processed" || state === "failed") setPolling(false);
  }, [state]);

  const start = async (force = false) => {
    setStarting(true);
    setError(null);
    try {
      await api(`/v1/resources/${id}/process`, { method: "POST", body: force ? { force: true } : {} });
      setStarted(true);
      setPolling(true);
      toast.success("Processing started", { description: "You can leave this page — it keeps going in the background." });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card shadow-xs" aria-labelledby="ingest-saved-title">
      <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center sm:p-6">
        {hosted && (thumbnail || videoId) ? (
          <MediaThumb src={thumbnail} videoId={videoId} alt="" youtube badgeSize="md" className="aspect-video w-full shrink-0 sm:w-40" />
        ) : (
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-ok-soft text-ok" aria-hidden>
            <CircleCheck className="size-7" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-ok uppercase">
            <CircleCheck className="size-3.5" aria-hidden /> Added to your library
          </p>
          <h2 id="ingest-saved-title" ref={headingRef} tabIndex={-1} className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink outline-none">
            {title}
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            {hosted
              ? transcriptSource === "gemini"
                ? "The video stays on YouTube. Gemini is writing out what is said, then it's linked to Scripture."
                : "The video stays on YouTube. Its captions are read, then linked to Scripture."
              : "It's in your library and ready to be linked to Scripture."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 sm:p-6">
        {!started && !error && (
          <Notice
            tone="info"
            icon={Sparkles}
            title="Start processing when you're ready"
            action={
              <Button onClick={() => void start()} disabled={starting} className="h-10 gap-2 rounded-xl px-4">
                {starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />} Start processing now
              </Button>
            }
          >
            Nothing is linked to Scripture until you do — it takes a few minutes and you can leave this page while it runs.
          </Notice>
        )}

        {error && (
          <Notice
            tone="danger"
            title="Couldn't start processing"
            action={
              <Button onClick={() => void start()} disabled={starting} className="h-10 gap-2 rounded-xl px-4">
                <RotateCcw className="size-4" aria-hidden /> Try again
              </Button>
            }
          >
            {error}
          </Notice>
        )}

        {started && failed && (
          <Notice
            tone="danger"
            title="Processing stopped with an error"
            action={
              <Button onClick={() => void start(true)} disabled={starting} className="h-10 gap-2 rounded-xl px-4">
                <RotateCcw className="size-4" aria-hidden /> Try again
              </Button>
            }
          >
            <p className="break-words">{run?.error || "Something went wrong. Your item is saved, so nothing is lost."}</p>
          </Notice>
        )}

        {started && !failed && (
          <div className="rounded-2xl border border-border bg-surface-2/40 p-4" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill tone={active ? "progress" : "ok"} icon={active ? undefined : CircleCheck}>
                  {active ? (state === "queued" ? "Waiting to start" : "Processing") : "Ready"}
                </StatusPill>
                <p className="text-sm font-medium text-ink">
                  {active
                    ? step
                      ? `Step ${step} of ${STAGE_ORDER.length} · ${stageTitle(run?.current_stage)}`
                      : "Waiting for a background worker…"
                    : ready
                      ? "All steps finished"
                      : "Finishing up"}
                </p>
              </div>
              <span className="text-sm font-semibold text-ink tabular-nums">{progress}%</span>
            </div>
            <Meter className="mt-3" value={progress / 100} tone={active ? "info" : "ok"} label={`Processing ${progress}% complete`} />
            <p className="mt-2 text-sm text-ink-2">
              {active ? (
                <>
                  {stageSummary(String(run?.current_stage ?? ""), (run?.stages || []).find((s: Json) => s.id === run?.current_stage)?.detail) ??
                    "This runs in the background — it's safe to close this page or add something else."}
                </>
              ) : ready ? (
                visible > 0 || inReview > 0 ? (
                  <>
                    {visible} verse link{visible === 1 ? "" : "s"} visible to readers
                    {inReview > 0 ? ` · ${inReview} waiting in your Review queue` : ""}.
                  </>
                ) : (
                  "No Bible verses were found in this one. You can still open it to read the transcript."
                )
              ) : (
                "Almost there."
              )}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link to={`/resources/${id}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-semibold text-primary-foreground no-underline shadow-sm transition hover:bg-primary/90 hover:text-primary-foreground hover:no-underline">
            {hosted ? <MonitorPlay className="size-4" aria-hidden /> : <Layers className="size-4" aria-hidden />} Open it {ready && visible > 0 ? "and see the verse clips" : "in the library"}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          {isEditor && (
            <Link to={`/admin/resources/${id}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-ink no-underline shadow-xs transition hover:bg-surface-2 hover:no-underline">
              <ListOrdered className="size-4" aria-hidden /> Follow every step
            </Link>
          )}
          <Button variant="ghost" onClick={onAddAnother} className="h-11 gap-2 rounded-xl px-4">
            <Upload className="size-4" aria-hidden /> Add another
          </Button>
        </div>
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────── aside

function HowItWorks() {
  const items: { icon: LucideIcon; title: string; text: string }[] = [
    { icon: FileUp, title: "1. Add it", text: "Upload a recording or document, paste a link, or paste text." },
    { icon: Sparkles, title: "2. It's linked to Scripture", text: "The words are split into sections and matched to the verses they mention, quote or talk about." },
    { icon: CircleCheck, title: "3. You stay in charge", text: "Anything uncertain waits in the Review queue until you approve it." },
  ];
  return (
    <aside className="grid grid-cols-1 content-start gap-4 md:grid-cols-2 2xl:grid-cols-1" aria-label="How it works">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-xs sm:p-5">
        <h2 className="font-display text-[17px] font-semibold text-ink">How it works</h2>
        <ul className="mt-3 grid grid-cols-1 gap-4">
          {items.map((i) => (
            <li key={i.title} className="flex gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold-400/15 text-gold-700 dark:text-gold-300" aria-hidden>
                <i.icon className="size-[18px]" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">{i.title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{i.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 text-[13px] leading-relaxed text-ink-2 shadow-xs sm:p-5">
        <p className="font-semibold text-ink">Good to know</p>
        <ul className="mt-2 grid grid-cols-1 list-disc gap-1.5 pl-4">
          <li>Your details are saved on this device as you type.</li>
          <li>Captions files skip AI transcription, so they're faster and free.</li>
          <li>
            You can change the title, sharing and rights later from the{" "}
            <Link to="/admin/resources" className="font-medium text-link">
              Processing monitor
            </Link>
            .
          </li>
        </ul>
      </div>
    </aside>
  );
}

