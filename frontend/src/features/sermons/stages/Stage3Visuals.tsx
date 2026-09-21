import {
  ArrowRight, BookMarked, Check, Clock, Download, Expand, ImageOff, Image as ImageIcon, Images, Loader2, Map as MapIcon, Palette, Pencil, RefreshCw,
  Sparkles, Trash2, Wand2, X, type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { jobKey, sermonApi, toastError, useJob, usePendingVariables, useStudioMutation } from "../api";
import { AiNote, AiProgress, ChoiceCard, ConfirmDialog, MetaPill, SectionCard, Skeleton, StageFooter, StageIntro, TextArea, fileSafe, plural } from "../components/StudioUI";
import type { MediaKind, SermonMedia } from "../types";
import { useWorkspace } from "../workspace";

const VISUAL_TYPES: { kind: MediaKind; label: string; desc: string; icon: LucideIcon; placeholder: string }[] = [
  {
    kind: "image",
    label: "Illustration",
    desc: "A painted Bible scene for the big screen",
    icon: ImageIcon,
    placeholder: "e.g. Jesus calming the storm, disciples in fear, waves crashing over the boat at night",
  },
  {
    kind: "map",
    label: "Bible map",
    desc: "The places in your message",
    icon: MapIcon,
    placeholder: "e.g. Map of ancient Israel showing the route from Egypt to Canaan",
  },
  {
    kind: "timeline",
    label: "Timeline",
    desc: "Events in order",
    icon: Clock,
    placeholder: "e.g. Timeline of major events in the life of the Apostle Paul",
  },
  {
    kind: "scripture_slide",
    label: "Scripture slide",
    desc: "A verse, ready to display",
    icon: BookMarked,
    placeholder: "e.g. John 3:16 — For God so loved the world",
  },
  {
    kind: "graphic",
    label: "Title graphic",
    desc: "For announcements & sharing",
    icon: Palette,
    placeholder: "e.g. Title banner for “Walking in Faith” with a cross and sunrise",
  },
];

const KIND_LABEL: Record<string, string> = { image: "Illustration", map: "Map", timeline: "Timeline", scripture_slide: "Scripture", graphic: "Graphic" };
const KIND_ICON: Record<string, LucideIcon> = { image: ImageIcon, map: MapIcon, timeline: Clock, scripture_slide: BookMarked, graphic: Palette };

const SET_COUNT = 6;
const SET_HINTS = ["Planning a scene for the title, Scripture and each point…", "Painting the scenes…", "High-quality images can take a minute or two…", "Saving your visuals…"];
const ONE_HINTS = ["Composing the scene…", "Painting your visual…", "Adding the finishing touches…"];
const AUTO_HINTS = ["Reading your sermon for the strongest image…", "Composing the scene…", "Painting your visual…"];

type GenerateVars = { kind: string; prompt?: string; auto_prompt?: boolean; high_quality?: boolean; regenerate_id?: string };

function extensionFor(item: SermonMedia): string {
  const mime = item.mime_type ?? "";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("png")) return "png";
  const m = (item.url ?? "").split("?")[0].match(/\.(png|jpe?g|webp|gif)$/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "png";
}

export function Stage3Visuals() {
  const { id, sermon, draft, media, cache, track, goToStage } = useWorkspace();
  const [kind, setKind] = useState<MediaKind>("image");
  const [prompt, setPrompt] = useState("");
  const [highQuality, setHighQuality] = useState(false);
  const [preview, setPreview] = useState<SermonMedia | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState<SermonMedia | null>(null);

  const genKey = jobKey(id, 3, "generate");
  const autoKey = jobKey(id, 3, "auto");
  const setKey = jobKey(id, 3, "set");
  const regenKey = jobKey(id, 3, "regenerate");
  const genJob = useJob(genKey);
  const autoJob = useJob(autoKey);
  const setJob = useJob(setKey);
  const regenerating = new Set(usePendingVariables<GenerateVars>(regenKey).map((v) => v.regenerate_id));

  // The server moves a polished sermon to "multimedia" when visuals are created; mirror that locally.
  const addMedia = (items: SermonMedia[]) =>
    cache.patch((d) => ({
      ...d,
      media: [...d.media, ...items.filter((m) => m && !d.media.some((x) => x.id === m.id))],
      sermon: d.sermon.status === "polished" ? { ...d.sermon, status: "multimedia" } : d.sermon,
    }));

  const generate = useStudioMutation(genKey, (v: GenerateVars) => sermonApi.generateMedia(id, v), {
    onSuccess: (res) => {
      if (res.media) addMedia([res.media]);
      else void cache.refresh();
      toast.success("Visual created", { description: "It's in your gallery below." });
    },
    errorTitle: "Couldn't create the visual",
  });
  const autoGenerate = useStudioMutation(autoKey, (v: GenerateVars) => sermonApi.generateMedia(id, v), {
    onSuccess: (res) => {
      if (res.media) addMedia([res.media]);
      else void cache.refresh();
      toast.success("Visual created from your sermon", { description: "It's in your gallery below." });
    },
    errorTitle: "Couldn't create a visual from your sermon",
  });
  const regenerate = useStudioMutation(regenKey, (v: GenerateVars) => sermonApi.generateMedia(id, v), {
    onSuccess: (res, v) => {
      if (res.media)
        cache.patch((d) => ({
          ...d,
          media: d.media.some((m) => m.id === v.regenerate_id) ? d.media.map((m) => (m.id === v.regenerate_id ? res.media : m)) : [...d.media, res.media],
        }));
      else void cache.refresh();
      toast.success("Visual replaced");
    },
    errorTitle: "Couldn't recreate that visual",
  });
  const generateSet = useStudioMutation(setKey, (v: { count: number; high_quality: boolean }) => sermonApi.generateMediaSet(id, v), {
    onSuccess: (res) => {
      const items = res.media ?? [];
      addMedia(items);
      const generated = res.generated ?? items.length;
      const requested = res.requested ?? generated;
      toast.success(
        `Created ${plural(generated, "visual")}`,
        requested > generated ? { description: `${requested - generated} couldn't be created this time — you can create those one at a time.` } : undefined,
      );
    },
    errorTitle: "Couldn't create the visual set",
  });

  const selectedType = VISUAL_TYPES.find((t) => t.kind === kind) ?? VISUAL_TYPES[0];

  const onGenerate = () => {
    const text = prompt.trim();
    if (!text) return void toast.error("Describe the visual first", { description: "Or use “Let AI choose from my sermon”." });
    generate.mutate({ kind, prompt: text, high_quality: highQuality }, { onSuccess: () => setPrompt("") });
  };
  const onAuto = () => {
    if (!draft) return void toast.error("Write your draft in Polish first");
    autoGenerate.mutate({ kind, auto_prompt: true, high_quality: highQuality });
  };
  const onSet = () => {
    if (!draft) return void toast.error("Write your draft in Polish first");
    generateSet.mutate({ count: SET_COUNT, high_quality: highQuality });
  };
  const runRegenerate = (item: SermonMedia) => {
    setConfirmRegen(null);
    if (!item.prompt && !draft) return void toast.error("This visual has no description to recreate it from");
    regenerate.mutate({ kind: item.kind, prompt: item.prompt ?? undefined, auto_prompt: !item.prompt || undefined, high_quality: highQuality, regenerate_id: item.id });
  };

  const saveCaption = async (item: SermonMedia, caption: string): Promise<boolean> => {
    const previous = item.caption;
    cache.patch((d) => ({ ...d, media: d.media.map((m) => (m.id === item.id ? { ...m, caption } : m)) }));
    try {
      const saved = await track(sermonApi.updateMedia(id, item.id, { caption }), "Couldn't save the caption");
      if (saved) cache.patch((d) => ({ ...d, media: d.media.map((m) => (m.id === item.id ? { ...m, ...saved } : m)) }));
      toast.success("Caption saved");
      return true;
    } catch {
      cache.patch((d) => ({ ...d, media: d.media.map((m) => (m.id === item.id ? { ...m, caption: previous } : m)) }));
      return false;
    }
  };

  const removeMedia = async (item: SermonMedia) => {
    cache.patch((d) => ({ ...d, media: d.media.filter((m) => m.id !== item.id) }));
    if (preview?.id === item.id) setPreviewOpen(false);
    try {
      await sermonApi.removeMedia(id, item.id);
      toast.success("Visual removed");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return;
      cache.patch((d) => (d.media.some((m) => m.id === item.id) ? d : { ...d, media: [...d.media, item].sort((a, b) => a.order_index - b.order_index) }));
      toastError(err, "Couldn't remove that visual");
    }
  };

  const sorted = [...media].sort((a, b) => a.order_index - b.order_index || a.created_at.localeCompare(b.created_at));
  const counts = Object.keys(KIND_LABEL)
    .map((k) => [k, media.filter((m) => m.kind === k).length] as const)
    .filter(([, n]) => n > 0);
  const pendingCards = [
    ...(genJob.pending ? [`Painting your ${selectedType.label.toLowerCase()}…`] : []),
    ...(autoJob.pending ? ["Choosing a scene from your sermon…"] : []),
    ...(setJob.pending ? Array.from({ length: SET_COUNT }, () => "Creating your visual set…") : []),
  ];
  const oneBusy = genJob.pending || autoJob.pending;

  return (
    <div className="grid grid-cols-1 gap-6">
      <StageIntro stage={3} aside={media.length ? <MetaPill tone="gold">{plural(media.length, "visual")}</MetaPill> : <MetaPill>Optional step</MetaPill>}>
        {media.length
          ? "Create more artwork, add captions, or continue to Publish when you're happy. Your visuals are used in your slides, video and share page."
          : "This step is optional. Create artwork for your slides, video and share page — or skip straight to Publish."}
      </StageIntro>

      <SectionCard
        icon={Sparkles}
        title="Create visuals"
        description="Make a whole set in one go, or create exactly the picture you have in mind."
        action={
          <div role="group" aria-label="Image quality" className="grid grid-cols-2 rounded-xl border border-border bg-surface-2/50 p-1">
            {[
              [false, "Standard", "Faster"],
              [true, "High quality", "More detail, slower"],
            ].map(([value, label, hint]) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={highQuality === value}
                title={hint as string}
                onClick={() => setHighQuality(value as boolean)}
                className={cn(
                  "h-9 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition outline-none focus-visible:ring-3 focus-visible:ring-ring",
                  highQuality === value ? "bg-card text-ink shadow-xs ring-1 ring-border" : "text-ink-3 hover:text-ink",
                )}
              >
                {label as string}
              </button>
            ))}
          </div>
        }
      >
        <div className="hero-sky relative overflow-hidden rounded-2xl p-5 text-white sm:p-6">
          <div
            className="absolute inset-0 opacity-30"
            aria-hidden
            style={{ backgroundImage: "radial-gradient(circle at 16% 24%, rgba(255,255,255,0.35) 1px, transparent 1.6px)", backgroundSize: "28px 28px" }}
          />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3.5">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/10 text-gold-300" aria-hidden>
                <Wand2 className="size-5" />
              </span>
              <div>
                <p className="font-display text-xl font-semibold">Create a full visual set</p>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-white/75">
                  {SET_COUNT} cinematic scenes — one for the title, the key Scripture and each main point — so every slide has a rich background.
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-white/60">
                  <Clock className="size-3.5" aria-hidden /> {highQuality ? "About 2–3 minutes in high quality" : "About 1–2 minutes"} · added to your gallery below
                </p>
              </div>
            </div>
            <Button
              onClick={onSet}
              disabled={setJob.pending || !draft}
              className="h-12 shrink-0 gap-2 rounded-xl bg-gold-400 px-6 text-[15px] font-semibold text-navy-900 hover:bg-gold-300 dark:bg-gold-400 dark:hover:bg-gold-300"
            >
              {setJob.pending ? <Loader2 className="size-4 animate-spin" /> : <Images className="size-4" />}
              {setJob.pending ? "Creating your set…" : "Create visual set"}
            </Button>
          </div>
          {!draft && <p className="relative mt-3 text-xs text-white/65">Available once your draft is written in Polish.</p>}
        </div>
        <AiProgress
          since={setJob.since}
          label={`Creating ${SET_COUNT} visuals for your sermon…`}
          hints={SET_HINTS}
          estimate={highQuality ? "2–3 minutes" : "1–2 minutes"}
          className="mt-4"
        />

        <div className="my-6 flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-ink-3">or create one at a time</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <p id="visual-kind-label" className="mb-3 text-[13px] font-semibold text-ink-2">
          1. What kind of visual?
        </p>
        <div role="group" aria-labelledby="visual-kind-label" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {VISUAL_TYPES.map((t) => (
            <ChoiceCard
              key={t.kind}
              selected={t.kind === kind}
              onSelect={() => setKind(t.kind)}
              icon={t.icon}
              title={t.label}
              description={t.desc}
              className={cn("min-h-[96px]", t.kind === "graphic" && "col-span-2 sm:col-span-1")}
            />
          ))}
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label htmlFor="visual-prompt" className="text-[13px] font-semibold text-ink-2">
              2. Describe it
            </label>
            <span className="text-xs text-ink-3">Or let AI choose from your sermon</span>
          </div>
          <TextArea
            id="visual-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={selectedType.placeholder}
            className="min-h-24"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onGenerate();
            }}
          />
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <AiNote className="max-w-md">
            Takes about {highQuality ? "a minute" : "20–40 seconds"}. New visuals are added to your gallery and used in your slides and share page.
          </AiNote>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex">
            <Button variant="outline" onClick={onAuto} disabled={oneBusy || !draft} title="AI picks a strong scene from your sermon" className="h-11 gap-2 rounded-xl px-4 sm:h-10">
              {autoJob.pending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {autoJob.pending ? "Choosing a scene…" : "Let AI choose from my sermon"}
            </Button>
            <Button onClick={onGenerate} disabled={oneBusy || !prompt.trim()} className="h-11 gap-2 rounded-xl px-5 sm:h-10">
              {genJob.pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {genJob.pending ? "Creating…" : `Create ${selectedType.label.toLowerCase()}`}
            </Button>
          </div>
        </div>
        <AiProgress since={genJob.since} label={`Creating your ${selectedType.label.toLowerCase()}…`} hints={ONE_HINTS} estimate="20–40 seconds" className="mt-4" />
        <AiProgress since={autoJob.since} label="Creating a visual from your sermon…" hints={AUTO_HINTS} estimate="about 30–60 seconds" className="mt-4" />
      </SectionCard>

      <section aria-labelledby="visuals-gallery" className="grid grid-cols-1 gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="visuals-gallery" className="font-display text-xl font-semibold tracking-tight text-ink">
              Your visuals {media.length > 0 && <span className="font-sans text-sm font-normal text-ink-3">({media.length})</span>}
            </h2>
            {media.length > 0 && <p className="mt-0.5 text-sm text-ink-3">Select a visual to see it larger. Captions appear on your share page.</p>}
          </div>
          {counts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {counts.map(([k, n]) => (
                <MetaPill key={k}>
                  {KIND_LABEL[k]} × {n}
                </MetaPill>
              ))}
            </div>
          )}
        </div>

        {sorted.length === 0 && pendingCards.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-gold-400/12 text-gold-600 dark:text-gold-300" aria-hidden>
              <Images className="size-6" />
            </span>
            <p className="mt-4 font-display text-lg font-semibold text-ink">No visuals yet</p>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-2">
              Create a full set above, or try “Let AI choose from my sermon” for a quick first picture. You can also skip this step.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {pendingCards.map((label, i) => (
              <li key={`pending-${i}`}>
                <PendingCard label={label} />
              </li>
            ))}
            {sorted.map((item, i) => (
              <li key={item.id} className="flex">
                <MediaCard
                  item={item}
                  index={i}
                  sermonTitle={sermon.title}
                  busy={regenerating.has(item.id)}
                  onPreview={() => {
                    setPreview(item);
                    setPreviewOpen(true);
                  }}
                  onRegenerate={() => setConfirmRegen(item)}
                  onRemove={() => void removeMedia(item)}
                  onSaveCaption={(c) => saveCaption(item, c)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <StageFooter
        onBack={() => goToStage(2)}
        backLabel="Back to Polish"
        hint={
          media.length ? (
            <>
              <span className="font-medium text-ink-2">Next: Publish.</span> Download slides and a PDF, then share your sermon.
            </>
          ) : (
            "Visuals are optional — you can export and share without them."
          )
        }
      >
        <Button onClick={() => goToStage(4)} className="h-12 w-full gap-2 rounded-xl px-6 text-[15px] font-semibold sm:w-auto">
          Continue to Publish <ArrowRight className="size-4" />
        </Button>
      </StageFooter>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="gap-3 p-3 sm:max-w-4xl">
          {preview && (
            <>
              <DialogTitle className="pr-10 pl-1 font-display text-base">
                {KIND_LABEL[preview.kind] ?? "Visual"}
                {preview.caption ? ` — ${preview.caption}` : ""}
              </DialogTitle>
              {preview.url && (
                <img src={preview.url} alt={preview.caption || preview.prompt || "Sermon visual"} className="max-h-[72vh] w-full rounded-lg bg-navy-950 object-contain" />
              )}
              {preview.prompt && <DialogDescription className="px-1 text-xs leading-relaxed italic">{preview.prompt}</DialogDescription>}
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmRegen}
        onOpenChange={(open) => !open && setConfirmRegen(null)}
        title="Replace this visual?"
        description="A new image is created from the same description and replaces this one. It takes about 30 seconds."
        confirmLabel="Create a new version"
        icon={RefreshCw}
        onConfirm={() => confirmRegen && runRegenerate(confirmRegen)}
      />
    </div>
  );
}

function PendingCard({ label }: { label: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-dashed border-gold-400/50 bg-card" role="status" aria-label={label}>
      <div className="relative grid aspect-video place-items-center overflow-hidden bg-surface-2">
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-gold-400/15 via-transparent to-navy-500/15" aria-hidden />
        <div className="relative flex flex-col items-center gap-2 px-4 text-center text-ink-2">
          <Loader2 className="size-6 animate-spin text-gold-500" aria-hidden />
          <span className="text-sm font-medium">{label}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 p-3.5">
        <Skeleton className="h-3 w-3/4 rounded-md" />
        <Skeleton className="h-3 w-1/2 rounded-md" />
      </div>
    </div>
  );
}

const overlayButton =
  "grid size-10 place-items-center rounded-lg bg-navy-950/65 text-white shadow-sm backdrop-blur transition outline-none hover:bg-navy-950/85 focus-visible:ring-3 focus-visible:ring-gold-300/70 disabled:opacity-60 sm:size-9";

function MediaCard({
  item,
  index,
  sermonTitle,
  busy,
  onPreview,
  onRegenerate,
  onRemove,
  onSaveCaption,
}: {
  item: SermonMedia;
  index: number;
  sermonTitle: string;
  busy: boolean;
  onPreview: () => void;
  onRegenerate: () => void;
  onRemove: () => void;
  onSaveCaption: (caption: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(item.caption ?? "");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [broken, setBroken] = useState(false);
  const label = KIND_LABEL[item.kind] ?? "Visual";
  const KindIcon = KIND_ICON[item.kind] ?? ImageIcon;

  useEffect(() => {
    if (!editing) setCaption(item.caption ?? "");
  }, [item.caption, editing]);
  useEffect(() => setBroken(false), [item.url]);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(t);
  }, [confirming]);

  const save = async () => {
    if (saving) return;
    const next = caption.trim();
    if (next === (item.caption ?? "")) return setEditing(false);
    setSaving(true);
    const ok = await onSaveCaption(next);
    setSaving(false);
    if (ok) setEditing(false);
  };

  const hasImage = !!item.url && !broken;

  return (
    <article
      className={cn("group flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition hover:shadow-md", confirming && "border-danger/40")}
    >
      <div className="relative aspect-video overflow-hidden bg-surface-2">
        {hasImage ? (
          <button type="button" onClick={onPreview} className="block size-full cursor-zoom-in outline-none" aria-label={`View ${label.toLowerCase()} ${index + 1} larger`}>
            <img
              src={item.url!}
              alt={item.caption || item.prompt || `${label} for ${sermonTitle}`}
              loading="lazy"
              decoding="async"
              onError={() => setBroken(true)}
              className="size-full object-cover transition duration-500 group-hover:scale-[1.02] motion-reduce:transition-none"
            />
          </button>
        ) : (
          <div className="grid size-full place-items-center text-ink-3">
            <span className="flex flex-col items-center gap-2 text-sm">
              <ImageOff className="size-6" aria-hidden /> Image unavailable
            </span>
          </div>
        )}
        <span className="pointer-events-none absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-navy-950/70 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur">
          <KindIcon className="size-3" aria-hidden /> {label}
        </span>
        {!busy && (
          <div className="absolute top-2 right-2 flex gap-1 opacity-100 transition [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
            {hasImage && (
              <button type="button" onClick={onPreview} className={overlayButton} aria-label="View larger" title="View larger">
                <Expand className="size-4" />
              </button>
            )}
            <button type="button" onClick={onRegenerate} className={overlayButton} aria-label="Create a new version" title="Create a new version">
              <RefreshCw className="size-4" />
            </button>
            {hasImage && (
              <a
                href={item.url!}
                download={`${fileSafe(sermonTitle)}-${label.toLowerCase()}-${index + 1}.${extensionFor(item)}`}
                className={cn(overlayButton, "no-underline hover:no-underline")}
                aria-label="Download image"
                title="Download image"
              >
                <Download className="size-4" />
              </a>
            )}
            <button type="button" onClick={() => setConfirming(true)} className={cn(overlayButton, "hover:bg-red-700/90")} aria-label="Remove visual" title="Remove">
              <Trash2 className="size-4" />
            </button>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-navy-950/60 text-white backdrop-blur-sm" role="status">
            <span className="flex flex-col items-center gap-2 text-sm font-medium">
              <Loader2 className="size-6 animate-spin" aria-hidden /> Creating a new version…
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a caption…"
              aria-label="Caption"
              maxLength={300}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") {
                  setCaption(item.caption ?? "");
                  setEditing(false);
                }
              }}
              className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-surface px-2.5 text-sm text-ink outline-none focus:border-gold-500/60 focus:ring-3 focus:ring-ring sm:h-9 dark:bg-surface-2/50"
            />
            <Button size="icon" onClick={() => void save()} disabled={saving} aria-label="Save caption" className="size-10 rounded-lg sm:size-9">
              {saving ? <Loader2 className="animate-spin" /> : <Check />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setCaption(item.caption ?? "");
                setEditing(false);
              }}
              aria-label="Cancel"
              className="size-10 rounded-lg sm:size-9"
            >
              <X />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="group/caption flex min-h-10 items-start gap-1.5 rounded-lg py-1 text-left text-sm text-ink-2 transition outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring"
          >
            {item.caption ? <span className="font-serif leading-snug text-ink">“{item.caption}”</span> : <span className="text-ink-3">+ Add a caption</span>}
            <Pencil className="mt-1 size-3 shrink-0 text-ink-3 opacity-60 transition group-hover/caption:opacity-100" aria-hidden />
          </button>
        )}

        {item.prompt && (
          <p className="line-clamp-2 text-xs leading-relaxed text-ink-3" title={item.prompt}>
            {item.prompt}
          </p>
        )}

        {confirming && (
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3" role="alertdialog" aria-label="Remove this visual?">
            <span className="mr-auto text-sm text-ink-2">Remove this visual?</span>
            <Button variant="ghost" onClick={() => setConfirming(false)} className="h-10 rounded-lg px-3 sm:h-9">
              Keep
            </Button>
            <Button variant="destructive" onClick={onRemove} className="h-10 gap-1.5 rounded-lg px-3 sm:h-9">
              <Trash2 className="size-4" /> Remove
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
