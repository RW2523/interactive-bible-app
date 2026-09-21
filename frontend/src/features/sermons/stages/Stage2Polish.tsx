import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  ArrowRight, BookOpen, Bold, Check, ChevronDown, Clapperboard, FilePenLine, GraduationCap, HandHeart, Heading2, Heading3, Italic, Languages,
  LayoutTemplate, Lightbulb, List, ListOrdered, ListTree, Loader2, Megaphone, MessageCircleHeart, PenLine, Quote, Redo2, RefreshCw, Save, ScrollText,
  SlidersHorizontal, Sparkles, Target, Undo2, Users, Wand2, Zap, type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { jobKey, sermonApi, useJob, useStoredSuggestions, useStudioMutation, type TemplateOption } from "../api";
import {
  AiNote, AiProgress, ChoiceCard, ConfirmDialog, CopyButton, FieldLabel, IconTile, MetaPill, NativeSelect, StageFooter, StageIntro, countWords, plural,
} from "../components/StudioUI";
import { htmlToStructured } from "../lib/sermon/legacy";
import "../sermon-studio.css";
import type { Suggestions } from "../types";
import { useWorkspace } from "../workspace";

const TEMPLATE_UI: Record<string, { icon: LucideIcon; desc: string }> = {
  message: { icon: BookOpen, desc: "Classic three-point sermon" },
  prayer: { icon: HandHeart, desc: "Praise, confession & intercession" },
  story: { icon: ScrollText, desc: "Built around a Bible story" },
  devotional: { icon: Sparkles, desc: "Short, personal reflection" },
  teaching: { icon: GraduationCap, desc: "In-depth study of a passage" },
  testimony: { icon: MessageCircleHeart, desc: "A personal witness" },
  youth: { icon: Zap, desc: "Lively and relatable" },
  small_group: { icon: Users, desc: "Discussion guide with questions" },
  storytelling: { icon: Clapperboard, desc: "Vivid, cinematic narrative" },
  custom: { icon: PenLine, desc: "Polish without restructuring" },
};

const POLISH_HINTS = [
  "Reading everything you collected…",
  "Finding the big idea and the key Scripture…",
  "Organizing your content into the chosen format…",
  "Writing in your chosen tone and language…",
  "Adding transitions, applications and a closing prayer…",
  "Almost there — tidying up the final draft…",
];
const TEMPLATE_HINTS = ["Mapping your draft onto the new outline…", "Rewriting sections so nothing is dropped…", "Polishing transitions…"];
const SUGGESTION_HINTS = ["Reading your draft…", "Looking for illustrations and applications…", "Finding cross-references and strong openings…"];

// Stable editor configuration (useEditor re-applies options whenever their identity changes).
const EDITOR_EXTENSIONS = [
  StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
  Placeholder.configure({ placeholder: "Start writing, or use “Write my draft” above to draft your sermon from the content you collected…" }),
];
const EDITOR_PROPS = {
  attributes: {
    class: "prose-sermon mx-auto min-h-[420px] w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-8",
    "aria-label": "Sermon draft",
    "aria-multiline": "true",
    role: "textbox",
  },
};

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  h2: boolean;
  h3: boolean;
  bullet: boolean;
  ordered: boolean;
  quote: boolean;
  canUndo: boolean;
  canRedo: boolean;
  words: number;
}

export function Stage2Polish() {
  const { id, sermon, inputs, draft, cache, track, goToStage, options, editorDirty, setEditorDirty, registerEditorFlush } = useWorkspace();
  const [template, setTemplate] = useState<string>(draft?.template_type || "message");
  const [tone, setTone] = useState(sermon.tone || "Inspirational");
  const [language, setLanguage] = useState(sermon.language || "English");
  const [confirmPolish, setConfirmPolish] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [styleOpen, setStyleOpen] = useState(!draft);

  // Keep the selectors in step with server changes (e.g. a polish finished while away).
  useEffect(() => {
    if (sermon.tone) setTone(sermon.tone);
  }, [sermon.tone]);
  useEffect(() => {
    if (sermon.language) setLanguage(sermon.language);
  }, [sermon.language]);
  useEffect(() => {
    if (draft?.template_type) setTemplate(draft.template_type);
  }, [draft?.template_type]);

  // A new draft version arrived: fold the style options away so the draft is front and centre.
  const lastDraftId = useRef(draft?.id ?? null);
  useEffect(() => {
    const next = draft?.id ?? null;
    if (next && next !== lastDraftId.current) setStyleOpen(false);
    lastDraftId.current = next;
  }, [draft?.id]);

  const selected: TemplateOption | undefined = options.templates.find((t) => t.value === template) ?? options.templates[0];
  const selectedLabel = selected?.label ?? "Sunday Message";
  const draftFormatLabel = options.templateLabel(draft?.template_type) ?? selectedLabel;
  const languageLabel = options.languages.find((l) => l.code === language)?.label ?? language;

  // ───────────────────────────── editor + autosave

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const titleRef = useRef(sermon.title);
  titleRef.current = sermon.title;
  const syncedHtml = useRef(""); // editor HTML known to be saved on the server
  const lastServerHtml = useRef<string | null>(draft?.polished_html ?? null);
  const serverEcho = useRef<string | null>(null); // polished_html returned by our own last save
  const latestHtml = useRef<string | null>(null);
  const autosaveTimer = useRef<number | undefined>(undefined);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const [saving, setSaving] = useState(false);

  const [initialContent] = useState(() => draft?.polished_html ?? "");
  // `editable` is toggled with setEditable() in the sync effect below (keeps the options object stable).
  const editor = useEditor({
    extensions: EDITOR_EXTENSIONS,
    content: initialContent,
    editorProps: EDITOR_PROPS,
    onCreate: ({ editor: e }) => {
      syncedHtml.current = e.getHTML();
    },
  });

  const toolbar = useEditorState<ToolbarState | null>({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            h2: e.isActive("heading", { level: 2 }),
            h3: e.isActive("heading", { level: 3 }),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            quote: e.isActive("blockquote"),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
            words: countWords(e.getText()),
          }
        : null,
  });

  const doSave = async (manual: boolean) => {
    const current = draftRef.current;
    const ed = editor && !editor.isDestroyed ? editor : null;
    const html = ed ? ed.getHTML() : latestHtml.current;
    if (!current || html == null) return;
    if (html === syncedHtml.current) {
      setEditorDirty(false);
      if (manual) toast.success("Draft saved");
      return;
    }
    const structured = htmlToStructured(html, titleRef.current);
    setSaving(true);
    try {
      const saved = await track(sermonApi.updateDraft(id, current.id, { polished_html: html, structured }), manual ? "Couldn't save your draft" : undefined);
      syncedHtml.current = html;
      const merged = { ...current, ...(saved ?? {}), polished_html: saved?.polished_html ?? html, structured: saved?.structured ?? structured };
      serverEcho.current = merged.polished_html;
      cache.patch((d) => (d.draft && d.draft.id === current.id ? { ...d, draft: { ...d.draft, ...merged } } : d));
      setEditorDirty(!!ed && !ed.isDestroyed && ed.getHTML() !== syncedHtml.current);
      if (manual) toast.success("Draft saved");
    } catch {
      /* the header indicator (and a toast for manual saves) report the failure */
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = (manual = false): Promise<void> => {
    window.clearTimeout(autosaveTimer.current);
    saveChain.current = saveChain.current.then(() => doSave(manual));
    return saveChain.current;
  };
  const saveRef = useRef(saveDraft);
  saveRef.current = saveDraft;

  // Let other stages (exports, outreach) flush unsaved edits before they read the draft.
  useEffect(() => {
    registerEditorFlush(() => saveRef.current(false));
    return () => registerEditorFlush(null);
  }, [registerEditorFlush]);

  // Mark dirty on edits and autosave after a short pause in typing.
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      const html = editor.getHTML();
      latestHtml.current = html;
      const dirty = html !== syncedHtml.current;
      setEditorDirty(dirty);
      window.clearTimeout(autosaveTimer.current);
      if (dirty && draftRef.current) autosaveTimer.current = window.setTimeout(() => void saveRef.current(false), 2500);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, setEditorDirty]);

  // Flush unsaved edits when leaving the workspace.
  useEffect(
    () => () => {
      window.clearTimeout(autosaveTimer.current);
      if (latestHtml.current != null && latestHtml.current !== syncedHtml.current) void saveRef.current(false);
      setEditorDirty(false);
    },
    [setEditorDirty],
  );

  // Load server-side draft changes (generate / apply format / first load) into the editor.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.isEditable !== !!draft) editor.setEditable(!!draft, false);
    const incoming = draft?.polished_html ?? "";
    if (incoming === (lastServerHtml.current ?? "")) return;
    lastServerHtml.current = incoming;
    if (serverEcho.current !== null && incoming === serverEcho.current) return; // our own save echoed back
    window.clearTimeout(autosaveTimer.current);
    editor.commands.setContent(incoming, { emitUpdate: false });
    syncedHtml.current = editor.getHTML();
    latestHtml.current = null;
    setEditorDirty(false);
  }, [editor, draft, draft?.polished_html, setEditorDirty]);

  // ───────────────────────────── AI actions

  const polishKey = jobKey(id, 2, "polish");
  const polishJob = useJob(polishKey);
  const polish = useStudioMutation(polishKey, (v: { tone: string; language: string; style: string }) => sermonApi.polish(id, v), {
    onSuccess: (res, v) => {
      cache.patch((d) => ({
        ...d,
        draft: res.draft ?? d.draft,
        // keep the locally tracked step: the user may have moved on while the draft was being written
        sermon: {
          ...d.sermon,
          status: d.sermon.status === "draft" ? "polished" : d.sermon.status,
          tone: v.tone,
          language: v.language,
          ...(res.sermon ?? {}),
          current_stage: d.sermon.current_stage,
        },
      }));
      toast.success("Your draft is ready", { description: "Read it through and make it your own — edits save automatically." });
    },
    errorTitle: "Couldn't write your draft",
  });

  const applyKey = jobKey(id, 2, "template");
  const applyJob = useJob(applyKey);
  const apply = useStudioMutation(
    applyKey,
    (v: { draft_id: string; template_type: string; tone: string; language: string; label: string }) =>
      sermonApi.applyTemplate(id, { draft_id: v.draft_id, template_type: v.template_type, tone: v.tone, language: v.language }),
    {
      onSuccess: (res, v) => {
        if (res.draft) cache.patch((d) => ({ ...d, draft: res.draft }));
        else void cache.refresh();
        setStyleOpen(false);
        toast.success(`Reshaped as ${v.label}`, { description: "Your draft now follows the new outline." });
      },
      errorTitle: "Couldn't reshape your draft",
    },
  );

  const suggestKey = jobKey(id, 2, "suggestions");
  const suggestJob = useJob(suggestKey);
  const stored = useStoredSuggestions(id, draft?.id);
  const suggestions = stored.data ?? null;
  const suggest = useStudioMutation(suggestKey, (draftId: string) => sermonApi.suggestions(id, draftId), {
    onSuccess: (res, draftId) => {
      cache.setSuggestions(draftId, res.suggestions ?? {});
      toast.success("Suggestions ready", { description: "Copy any idea you like into your draft." });
    },
    errorTitle: "Couldn't get suggestions",
  });

  const busy = polishJob.pending || applyJob.pending;

  const runPolish = async () => {
    setConfirmPolish(false);
    if (editorDirty) await saveDraft(false);
    polish.mutate({ tone, language, style: template });
  };

  const onGenerate = () => {
    if (!inputs.length) return void toast.error("Add content in Collect first");
    if (draft) setConfirmPolish(true);
    else void runPolish();
  };

  const runApply = async () => {
    setConfirmApply(false);
    if (!draft) return void toast.error("Write your draft first");
    await saveDraft(false);
    apply.mutate({ draft_id: draft.id, template_type: template, tone, language, label: selectedLabel });
  };

  const onSuggest = async () => {
    if (!draft || !editor || editor.isEmpty) return void toast.error("Write your draft first to get suggestions");
    await saveDraft(false);
    suggest.mutate(draft.id);
  };

  const words = toolbar?.words ?? 0;
  const minutes = Math.max(1, Math.round(words / 130));
  const FormatIcon = (TEMPLATE_UI[draft?.template_type ?? template] ?? { icon: LayoutTemplate }).icon;

  return (
    <div className="grid grid-cols-1 gap-6">
      <StageIntro stage={2} aside={draft ? <MetaPill tone="gold">{plural(words, "word")} · about {minutes} min to preach</MetaPill> : undefined}>
        {draft
          ? "Read through your draft and make it your own — edits save automatically. Ask for suggestions whenever you'd like fresh ideas."
          : `Choose a format, tone and language, then let AI write a first draft from your ${plural(inputs.length, "collected item")}.`}
      </StageIntro>

      {/* ── Style ── */}
      <section aria-labelledby="style-title" className="rounded-2xl border border-border bg-card shadow-xs">
        <header className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <IconTile icon={SlidersHorizontal} />
            <div className="min-w-0 self-center">
              <h2 id="style-title" className="font-display text-lg leading-snug font-semibold tracking-tight text-ink">
                {draft ? "Sermon style" : "Choose your sermon style"}
              </h2>
              {draft ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <MetaPill icon={FormatIcon}>
                    <span className="text-ink-3">Format</span> {draftFormatLabel}
                  </MetaPill>
                  <MetaPill icon={MessageCircleHeart}>
                    <span className="text-ink-3">Tone</span> {sermon.tone || tone}
                  </MetaPill>
                  <MetaPill icon={Languages}>
                    <span className="text-ink-3">Language</span> {options.languages.find((l) => l.code === (sermon.language || language))?.label ?? sermon.language}
                  </MetaPill>
                </div>
              ) : (
                <p className="mt-0.5 text-sm leading-relaxed text-ink-2">Pick what fits the occasion — you can reshape the draft into another style later.</p>
              )}
            </div>
          </div>
          {draft && (
            <Button
              variant="outline"
              onClick={() => setStyleOpen((v) => !v)}
              aria-expanded={styleOpen}
              aria-controls="style-options"
              className="h-11 shrink-0 gap-2 rounded-xl px-4 sm:h-10"
            >
              {styleOpen ? "Close" : "Change style"} <ChevronDown className={cn("size-4 transition", styleOpen && "rotate-180")} />
            </Button>
          )}
        </header>

        {(polishJob.pending || applyJob.pending) && (
          <div className="px-4 pb-4 sm:px-5">
            <AiProgress since={polishJob.since} label={`Writing your ${selectedLabel.toLowerCase()} draft…`} hints={POLISH_HINTS} estimate="about a minute" />
            <AiProgress since={applyJob.since} label={`Reshaping your draft as ${selectedLabel}…`} hints={TEMPLATE_HINTS} estimate="about a minute" />
          </div>
        )}

        {styleOpen && (
          <div id="style-options" className="grid grid-cols-1 gap-6 border-t border-border p-4 sm:p-5">
            <div>
              <p id="format-label" className="mb-1 text-[13px] font-semibold text-ink-2">
                Format
              </p>
              <p className="mb-3 text-xs text-ink-3">How the message is organized.</p>
              <div role="group" aria-labelledby="format-label" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {options.templates.map((t) => {
                  const ui = TEMPLATE_UI[t.value] ?? { icon: LayoutTemplate, desc: t.summary };
                  return (
                    <ChoiceCard key={t.value} selected={t.value === template} onSelect={() => setTemplate(t.value)} icon={ui.icon} title={t.label} description={ui.desc} />
                  );
                })}
              </div>
              {selected && (
                <div className="mt-3 rounded-xl border border-border bg-paper-2/70 p-4 dark:bg-surface-2/30">
                  <div className="flex items-start gap-2.5">
                    <ListTree className="mt-0.5 size-4 shrink-0 text-gold-600 dark:text-gold-300" aria-hidden />
                    <p className="text-sm leading-relaxed text-ink-2">
                      <span className="font-semibold text-ink">What a {selected.label} includes.</span> {selected.summary}
                    </p>
                  </div>
                  {selected.sections.length > 0 && (
                    <ol className="mt-3 grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2">
                      {selected.sections.map((sec, i) => (
                        <li key={`${sec.name}-${i}`} className="flex gap-2.5 text-[13px] leading-snug">
                          <span
                            className="grid size-5 shrink-0 place-items-center rounded-full bg-gold-400/15 text-[11px] font-semibold text-gold-700 dark:text-gold-300"
                            aria-hidden
                          >
                            {i + 1}
                          </span>
                          <span>
                            <span className="font-medium text-ink">{sec.name}</span>
                            {sec.subtopics?.length > 0 && <span className="text-ink-3"> — {sec.subtopics.join(" · ")}</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>

            <div>
              <p id="tone-label" className="mb-1 text-[13px] font-semibold text-ink-2">
                Tone
              </p>
              <p className="mb-3 text-xs text-ink-3">The voice your sermon is written in.</p>
              <div role="group" aria-labelledby="tone-label" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {!options.tones.some((t) => t.id === tone) && <ChoiceCard compact selected onSelect={() => undefined} title={tone} />}
                {options.tones.map((t) => (
                  <ChoiceCard key={t.id} compact selected={t.id === tone} onSelect={() => setTone(t.id)} title={t.label} description={t.hint} />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:items-end">
              <div>
                <FieldLabel htmlFor="polish-language">Language</FieldLabel>
                <NativeSelect id="polish-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {!options.languages.some((l) => l.code === language) && <option value={language}>{language}</option>}
                  {options.languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                      {l.label !== l.code ? ` (${l.code})` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <p className="pb-2.5 text-xs leading-relaxed text-ink-3">
                Your draft is written in {languageLabel}.
                {options.isComplexScript(language) && " PDFs for this script are made from the print view so every character looks right."}
              </p>
            </div>

            {!draft ? (
              <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <AiNote className="max-w-lg text-[13px]">
                  AI reads your {plural(inputs.length, "item")} and writes a complete {selectedLabel.toLowerCase()} in this style. It takes about a minute; the draft
                  appears below and is saved automatically.
                </AiNote>
                <Button onClick={onGenerate} disabled={busy || !inputs.length} className="h-12 shrink-0 gap-2 rounded-xl px-6 text-[15px] font-semibold">
                  {polishJob.pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {polishJob.pending ? "Writing your draft…" : "Write my draft"}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 border-t border-border pt-5 md:grid-cols-2">
                <ActionOption
                  icon={LayoutTemplate}
                  title="Reshape this draft"
                  description={`Keeps your current text and edits, and reorganizes them into the ${selectedLabel} outline with this tone and language. A designed slide deck will need redesigning.`}
                >
                  <Button variant="outline" onClick={() => setConfirmApply(true)} disabled={busy} className="h-11 w-full gap-2 rounded-xl sm:h-10 sm:w-auto">
                    {applyJob.pending ? <Loader2 className="size-4 animate-spin" /> : <LayoutTemplate className="size-4" />}
                    {applyJob.pending ? "Reshaping…" : "Reshape draft"}
                  </Button>
                </ActionOption>
                <ActionOption
                  icon={Wand2}
                  title="Write a fresh draft"
                  description="Starts again from your collected content and replaces the text in the editor with a new version."
                >
                  <Button variant="outline" onClick={onGenerate} disabled={busy || !inputs.length} className="h-11 w-full gap-2 rounded-xl sm:h-10 sm:w-auto">
                    {polishJob.pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {polishJob.pending ? "Writing…" : "Write fresh draft"}
                  </Button>
                </ActionOption>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Draft + suggestions ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
        <section aria-labelledby="draft-editor-title" className="min-w-0 rounded-2xl border border-border bg-card shadow-xs transition focus-within:border-gold-400/50">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3.5 sm:px-5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <IconTile icon={FilePenLine} size="sm" />
              <h2 id="draft-editor-title" className="font-display text-lg font-semibold tracking-tight text-ink">
                Your draft
              </h2>
              {draft && <MetaPill>Version {draft.version}</MetaPill>}
            </div>
            {draft && (
              <span className="text-xs text-ink-3 tabular-nums">
                {plural(words, "word")} · about {minutes} min
              </span>
            )}
          </header>
          <EditorToolbar editor={editor} state={toolbar} disabled={!draft} dirty={editorDirty} saving={saving} onSave={() => void saveDraft(true)} />
          <div
            className="sermon-editor relative"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                void saveDraft(true);
              }
            }}
          >
            <EditorContent editor={editor} />
            {!draft && (
              <div className="absolute inset-0 grid place-items-center rounded-b-2xl bg-card/85 p-6 backdrop-blur-[1px]">
                <div className="max-w-sm text-center" role={polishJob.pending ? "status" : undefined}>
                  <span className="mx-auto grid size-14 place-items-center rounded-full bg-gold-400/12 text-gold-600 dark:text-gold-300" aria-hidden>
                    {polishJob.pending ? <Loader2 className="size-6 animate-spin" /> : <FilePenLine className="size-6" />}
                  </span>
                  <p className="mt-3 font-display text-lg font-semibold text-ink">{polishJob.pending ? "Writing your draft…" : "Your draft will appear here"}</p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-2">
                    {polishJob.pending
                      ? "This takes about a minute. Feel free to look around — it's saved automatically when it's ready."
                      : "Choose a style above and press “Write my draft”. You'll be able to edit every word."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <SuggestionsPanel
          hasDraft={!!draft}
          suggestions={suggestions}
          pending={suggestJob.pending}
          since={suggestJob.since}
          onSuggest={() => void onSuggest()}
        />
      </div>

      <StageFooter
        onBack={() => goToStage(1)}
        backLabel="Back to Collect"
        hint={
          !draft ? (
            "Write your draft to continue."
          ) : editorDirty ? (
            "Your latest edits are saved when you continue."
          ) : (
            <>
              <span className="font-medium text-ink-2">Next: Visuals</span> (optional) — artwork for your slides and share page.
            </>
          )
        }
      >
        {draft && (
          <Button
            variant="ghost"
            onClick={async () => {
              await saveDraft(false);
              goToStage(4);
            }}
            className="h-12 gap-2 rounded-xl px-4 text-ink-2 sm:h-11"
          >
            Skip to Publish
          </Button>
        )}
        <Button
          onClick={async () => {
            await saveDraft(false);
            goToStage(3);
          }}
          disabled={!draft}
          className="h-12 w-full gap-2 rounded-xl px-6 text-[15px] font-semibold sm:w-auto"
        >
          Continue to Visuals <ArrowRight className="size-4" />
        </Button>
      </StageFooter>

      <ConfirmDialog
        open={confirmPolish}
        onOpenChange={setConfirmPolish}
        title="Write a fresh draft?"
        description={
          <>
            A new {selectedLabel.toLowerCase()} will be written from your collected content and replace the text in the editor
            {draft ? ` (version ${draft.version})` : ""}. To keep your edits and only reorganize them, use “Reshape draft” instead.
          </>
        }
        confirmLabel="Write fresh draft"
        icon={Sparkles}
        onConfirm={() => void runPolish()}
      />
      <ConfirmDialog
        open={confirmApply}
        onOpenChange={setConfirmApply}
        title={`Reshape your draft as ${selectedLabel}?`}
        description="Your draft will be rewritten to follow this outline, keeping its content. Any slide deck you designed is cleared so it can be redesigned for the new structure."
        confirmLabel="Reshape draft"
        icon={LayoutTemplate}
        onConfirm={() => void runApply()}
      />
    </div>
  );
}

function ActionOption({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-paper-2/60 p-4 dark:bg-surface-2/30">
      <div className="flex items-start gap-3">
        <IconTile icon={Icon} size="sm" />
        <div className="min-w-0">
          <p className="font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{description}</p>
        </div>
      </div>
      <div className="mt-auto">{children}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── toolbar

function EditorToolbar({
  editor,
  state,
  disabled,
  dirty,
  saving,
  onSave,
}: {
  editor: Editor | null;
  state: ToolbarState | null;
  disabled: boolean;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const tools: { key: string; label: string; icon: LucideIcon; active?: boolean; enabled?: boolean; run: (e: Editor) => void }[] = [
    { key: "h2", label: "Section heading", icon: Heading2, active: state?.h2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { key: "h3", label: "Subheading", icon: Heading3, active: state?.h3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
    { key: "bold", label: "Bold (⌘B)", icon: Bold, active: state?.bold, run: (e) => e.chain().focus().toggleBold().run() },
    { key: "italic", label: "Italic (⌘I)", icon: Italic, active: state?.italic, run: (e) => e.chain().focus().toggleItalic().run() },
    { key: "bullet", label: "Bulleted list", icon: List, active: state?.bullet, run: (e) => e.chain().focus().toggleBulletList().run() },
    { key: "ordered", label: "Numbered list", icon: ListOrdered, active: state?.ordered, run: (e) => e.chain().focus().toggleOrderedList().run() },
    { key: "quote", label: "Scripture or quote", icon: Quote, active: state?.quote, run: (e) => e.chain().focus().toggleBlockquote().run() },
  ];
  const history: typeof tools = [
    { key: "undo", label: "Undo (⌘Z)", icon: Undo2, enabled: state?.canUndo, run: (e) => e.chain().focus().undo().run() },
    { key: "redo", label: "Redo (⇧⌘Z)", icon: Redo2, enabled: state?.canRedo, run: (e) => e.chain().focus().redo().run() },
  ];
  const btn = (t: (typeof tools)[number]) => (
    <Button
      key={t.key}
      type="button"
      variant="ghost"
      size="icon"
      title={t.label}
      aria-label={t.label}
      aria-pressed={t.active === undefined ? undefined : !!t.active}
      disabled={disabled || !editor || t.enabled === false}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => editor && t.run(editor)}
      className={cn("size-10 rounded-lg text-ink-2 hover:text-ink sm:size-8", t.active && "bg-surface-2 text-ink")}
    >
      <t.icon className="size-4" />
    </Button>
  );
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="sticky top-[calc(var(--header-h)+3.5rem)] z-10 flex flex-wrap items-center gap-0.5 border-b border-border bg-card/95 px-2 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:px-3"
    >
      {tools.map(btn)}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      {history.map(btn)}
      <span className="flex-1" />
      {!disabled && (
        <span className="hidden pr-2 text-xs text-ink-3 sm:inline" aria-live="polite">
          {saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved automatically"}
        </span>
      )}
      <Button
        type="button"
        variant={dirty ? "default" : "ghost"}
        size="sm"
        onClick={onSave}
        disabled={disabled || saving}
        className="h-10 gap-1.5 rounded-lg px-3 sm:h-8"
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : dirty ? <Save className="size-3.5" /> : <Check className="size-3.5" />}
        {dirty ? "Save" : "Saved"}
      </Button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── suggestions

function SuggestionsPanel({
  hasDraft,
  suggestions,
  pending,
  since,
  onSuggest,
}: {
  hasDraft: boolean;
  suggestions: Suggestions | null;
  pending: boolean;
  since: number | null;
  onSuggest: () => void;
}) {
  return (
    <aside
      aria-labelledby="suggestions-title"
      className="min-w-0 rounded-2xl border border-border bg-card shadow-xs xl:sticky xl:top-[calc(var(--header-h)+4.5rem)] xl:flex xl:max-h-[calc(100dvh-var(--header-h)-6rem)] xl:flex-col"
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-4">
        <IconTile icon={Lightbulb} />
        <div className="min-w-0 self-center">
          <h2 id="suggestions-title" className="font-display text-lg leading-snug font-semibold tracking-tight text-ink">
            Ideas to strengthen it
          </h2>
          <p className="mt-0.5 text-sm leading-relaxed text-ink-2">Illustrations, applications, cross-references, openings and closings.</p>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-4 p-4 xl:min-h-0 xl:overflow-y-auto">
        {!pending && (
          <div className="grid grid-cols-1 gap-2">
            <Button onClick={onSuggest} disabled={!hasDraft} variant={suggestions ? "outline" : "default"} className="h-11 w-full gap-2 rounded-xl">
              {suggestions ? <RefreshCw className="size-4" /> : <Lightbulb className="size-4" />}
              {suggestions ? "Get new suggestions" : "Get suggestions"}
            </Button>
            <AiNote>
              {hasDraft ? "AI reads your current draft — about 30 seconds. Nothing in your draft is changed." : "Available once your draft is written."}
            </AiNote>
          </div>
        )}
        <AiProgress
          since={since}
          label="Reviewing your sermon…"
          hints={SUGGESTION_HINTS}
          estimate="about 30 seconds"
          note="You can keep editing while this runs — your draft isn't changed."
        />
        {suggestions && <SuggestionsView suggestions={suggestions} />}
      </div>
    </aside>
  );
}

function SuggestionsView({ suggestions: s }: { suggestions: Suggestions }) {
  const empty =
    !s.strengthening_tips?.length && !s.illustrations?.length && !s.applications?.length && !s.scripture_connections?.length && !s.opening_hooks?.length && !s.closing_calls?.length;
  if (empty) return <p className="rounded-xl bg-surface-2/60 px-4 py-6 text-center text-sm text-ink-3">No suggestions came back this time — try again in a moment.</p>;
  return (
    <div className="grid grid-cols-1 gap-3">
      {!!s.strengthening_tips?.length && (
        <Group icon={Target} title="Strengthening tips" count={s.strengthening_tips.length} defaultOpen>
          {s.strengthening_tips.map((tip, i) => (
            <Item key={i} copy={tip}>
              <p className="text-sm leading-relaxed text-ink">{tip}</p>
            </Item>
          ))}
        </Group>
      )}
      {!!s.opening_hooks?.length && (
        <Group icon={Megaphone} title="Opening hooks" count={s.opening_hooks.length}>
          {s.opening_hooks.map((hook, i) => (
            <Item key={i} copy={hook}>
              <p className="font-serif text-[15px] leading-relaxed text-ink">“{hook}”</p>
            </Item>
          ))}
        </Group>
      )}
      {!!s.illustrations?.length && (
        <Group icon={ScrollText} title="Illustration ideas" count={s.illustrations.length}>
          {s.illustrations.map((ill, i) => (
            <Item key={i} copy={`${ill.title}: ${ill.description}`}>
              <p className="text-sm font-semibold text-ink">{ill.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{ill.description}</p>
            </Item>
          ))}
        </Group>
      )}
      {!!s.applications?.length && (
        <Group icon={Users} title="Application points" count={s.applications.length}>
          {s.applications.map((app, i) => (
            <Item key={i} copy={app.suggestion}>
              <p className="text-xs font-semibold text-gold-700 dark:text-gold-300">{app.point}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink">{app.suggestion}</p>
            </Item>
          ))}
        </Group>
      )}
      {!!s.scripture_connections?.length && (
        <Group icon={BookOpen} title="Scripture cross-references" count={s.scripture_connections.length}>
          {s.scripture_connections.map((sc, i) => (
            <Item key={i} copy={sc.verse_text ? `${sc.reference} — ${sc.verse_text}` : sc.reference}>
              <span className="inline-flex rounded-full bg-[var(--gold-soft)] px-2 py-0.5 text-xs font-semibold text-gold-700 dark:text-gold-300">{sc.reference}</span>
              {sc.verse_text && <p className="mt-1.5 border-l-2 border-gold-400/70 pl-2.5 font-serif text-[14px] leading-relaxed text-ink">{sc.verse_text}</p>}
              <p className="mt-1 text-sm leading-relaxed text-ink-2">{sc.connection}</p>
            </Item>
          ))}
        </Group>
      )}
      {!!s.closing_calls?.length && (
        <Group icon={HandHeart} title="Closing calls to action" count={s.closing_calls.length}>
          {s.closing_calls.map((cta, i) => (
            <Item key={i} copy={cta}>
              <p className="font-serif text-[15px] leading-relaxed text-ink">“{cta}”</p>
            </Item>
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ icon: Icon, title, count, children, defaultOpen }: { icon: LucideIcon; title: string; count: number; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group/sugg rounded-xl border border-border bg-paper-2/40 dark:bg-surface-2/20">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-ink outline-none select-none focus-visible:ring-3 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Icon className="size-4 shrink-0 text-gold-600 dark:text-gold-300" aria-hidden />
        <span className="flex-1">{title}</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-2 tabular-nums">{count}</span>
        <ChevronDown className="size-4 text-ink-3 transition group-open/sugg:rotate-180" aria-hidden />
      </summary>
      <ul className="grid grid-cols-1 gap-2 px-2 pb-2">{children}</ul>
    </details>
  );
}

function Item({ copy, children }: { copy: string; children: ReactNode }) {
  return (
    <li className="relative rounded-lg border border-border bg-card py-2.5 pr-12 pl-3 sm:pr-10">
      {children}
      <CopyButton text={copy} label="Copy this idea" className="absolute top-1 right-1" toastMessage="Copied — paste it into your draft" />
    </li>
  );
}
