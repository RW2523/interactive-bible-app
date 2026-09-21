import { Tabs } from "@base-ui/react/tabs";
import {
  ArrowRight, AudioLines, BookOpen, ChevronDown, FilePlus, FileText, FileUp, Inbox, Loader2, Mic, MicOff, NotebookPen, Save, Trash2, Type, Upload, X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { useTranslations } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import { jobKey, sermonApi, toastError, useJob, usePendingVariables, useStudioMutation } from "../api";
import {
  ConfirmDialog, FieldLabel, MetaPill, NativeSelect, Notice, SectionCard, StageFooter, StageIntro, TextArea, TextInput, countWords, plural, readStorage,
  writeStorage,
} from "../components/StudioUI";
import { speechLocale } from "../lib/sermon/templates";
import type { SermonInput } from "../types";
import { useCommitField, useWorkspace } from "../workspace";

type TabId = "notes" | "dictate" | "audio" | "document" | "bible";

const METHODS: { id: TabId; label: string; desc: string; icon: LucideIcon }[] = [
  { id: "notes", label: "Type notes", desc: "Outline, ideas, illustrations", icon: Type },
  { id: "dictate", label: "Speak", desc: "Your words appear as you talk", icon: Mic },
  { id: "audio", label: "Recording", desc: "Upload audio to transcribe", icon: AudioLines },
  { id: "document", label: "Document", desc: "PDF, Word or text file", icon: FileUp },
  { id: "bible", label: "Scripture", desc: "Look up a Bible passage", icon: BookOpen },
];

const QUICK_REFS = ["John 3:16", "Psalm 23", "Romans 8:28", "Philippians 4:13", "Isaiah 40:31", "Jeremiah 29:11", "Matthew 28:19-20", "Proverbs 3:5-6"];

// Mirrors the server's accepted types and limits (long recordings are split and transcribed in chunks).
const AUDIO_MAX_MB = 1024;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4)$/i;
const AUDIO_ACCEPT = "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm,.mp4";
const DOC_MAX_MB = 50;
const DOC_EXT = /\.(pdf|docx|txt|md|markdown|html?)$/i;
const DOC_ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/html";

const KIND_META: Record<string, { label: string; icon: LucideIcon; className: string }> = {
  text: { label: "Notes", icon: Type, className: "bg-surface-2 text-ink-2" },
  dictation: { label: "Spoken notes", icon: Mic, className: "bg-[var(--rel-quote-soft)] text-[var(--rel-quote)]" },
  audio: { label: "Recording", icon: AudioLines, className: "bg-[var(--rel-ai-soft)] text-[var(--rel-ai)]" },
  document: { label: "Document", icon: FileText, className: "bg-[var(--rel-direct-soft)] text-[var(--rel-direct)]" },
  file: { label: "File", icon: FilePlus, className: "bg-[var(--rel-direct-soft)] text-[var(--rel-direct)]" },
  bible_ref: { label: "Scripture", icon: BookOpen, className: "bg-[var(--gold-soft)] text-gold-700 dark:text-gold-300" },
};

interface CollectBuffer {
  typedText?: string;
  dictationText?: string;
  bibleVerse?: string;
  bibleNotes?: string;
}

const bufferKey = (id: string) => `ibible_sermon_collect_${id}`;

type RecognitionCtor = new () => SpeechRecognition;
function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function describeInput(input: SermonInput): { title: string | null; verse: string | null; body: string | null; words: number } {
  const meta = input.meta ?? {};
  if (input.kind === "bible_ref") {
    const raw = (input.raw_text ?? "").trim();
    const verse = typeof meta.verse_text === "string" && meta.verse_text.trim() ? meta.verse_text.trim() : null;
    const reference =
      (typeof meta.reference === "string" && meta.reference) || raw.match(/^Scripture:\s*(.+?)(?:\s*\([A-Z0-9]+\))?$/m)?.[1] || raw.split("\n")[0] || "Scripture";
    const translation = typeof meta.translation === "string" && meta.translation ? meta.translation.toUpperCase() : null;
    const text = (input.text ?? "").trim();
    const textLooksLikeNotes = !!text && text !== reference && !/^Scripture:/i.test(text) && !(verse && text.includes(verse));
    const notes =
      (typeof meta.notes === "string" && meta.notes.trim()) || (raw.match(/Study notes:\s*([\s\S]+)$/i)?.[1]?.trim() ?? null) || (textLooksLikeNotes ? text : null);
    return { title: translation ? `${reference} · ${translation}` : reference, verse, body: notes || null, words: countWords(verse) + countWords(notes) };
  }
  const body = input.transcription || input.text || input.raw_text || null;
  const title = input.kind === "audio" ? input.original_filename || "Audio recording" : input.kind === "document" ? input.original_filename || "Document" : null;
  return { title, verse: null, body, words: countWords(body) };
}

export function Stage1Collect() {
  const { id, sermon, inputs, cache, goToStage, active } = useWorkspace();
  const restored = useMemo(() => readStorage<CollectBuffer>(bufferKey(id)) ?? {}, [id]);
  // Reopen the method that still holds unsaved text, so nothing typed earlier looks lost.
  const [tab, setTab] = useState<TabId>(() =>
    restored.typedText ? "notes" : restored.dictationText ? "dictate" : restored.bibleVerse || restored.bibleNotes ? "bible" : "notes",
  );
  const [typedText, setTypedText] = useState(restored.typedText ?? "");
  const [dictationText, setDictationText] = useState(restored.dictationText ?? "");
  const [bibleVerse, setBibleVerse] = useState(restored.bibleVerse ?? "");
  const [bibleNotes, setBibleNotes] = useState(restored.bibleNotes ?? "");
  const [translation, setTranslation] = useState("web");
  const [bibleError, setBibleError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const translations = useTranslations();

  // Buffer unsaved typing/dictation/scripture on this device so switching stages
  // or reloading never silently discards work that hasn't been saved yet.
  useEffect(() => {
    const t = setTimeout(() => {
      const any = typedText || dictationText || bibleVerse || bibleNotes;
      writeStorage(bufferKey(id), any ? { typedText, dictationText, bibleVerse, bibleNotes } : null);
    }, 400);
    return () => clearTimeout(t);
  }, [id, typedText, dictationText, bibleVerse, bibleNotes]);

  const addInput = (input: SermonInput | null) => {
    if (input) cache.patch((d) => (d.inputs.some((i) => i.id === input.id) ? d : { ...d, inputs: [...d.inputs, input] }));
    else void cache.refresh();
  };

  // ── text + dictation ──
  const addText = useStudioMutation(jobKey(id, 1, "text"), (v: { kind: "text" | "dictation"; text: string }) => sermonApi.addText(id, v.kind, v.text), {
    onSuccess: (input, v) => {
      addInput(input);
      toast.success(v.kind === "text" ? "Notes added to your content" : "Spoken notes added to your content");
    },
    errorTitle: "Couldn't save your notes",
  });
  const savingKind = addText.isPending ? addText.variables?.kind : null;

  const saveTyped = () => {
    const text = typedText.trim();
    if (!text) return;
    addText.mutate({ kind: "text", text }, { onSuccess: () => setTypedText("") });
  };

  // ── live dictation (Web Speech API) ──
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const dictationBase = useRef("");
  const [listening, setListening] = useState(false);
  const speechSupported = useMemo(() => !!getRecognitionCtor(), []);

  const stopDictation = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const startDictation = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      toast.error("Live dictation isn't supported in this browser", { description: "Try Chrome, Edge or Safari — or upload a recording instead." });
      return;
    }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = speechLocale(sermon.language);
    // Keep earlier unsaved dictation: new speech is appended to it.
    dictationBase.current = dictationText.trim() ? `${dictationText.trim()} ` : "";
    rec.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setDictationText(dictationBase.current + transcript.trimStart());
    };
    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error("Microphone access was blocked", { description: "Allow microphone access for this site to dictate." });
      } else if (event.error === "audio-capture") {
        toast.error("No microphone found", { description: "Connect a microphone and try again." });
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        toast.error("Dictation stopped", { description: event.message || event.error });
      }
    };
    rec.onend = () => {
      if (recognitionRef.current === rec) recognitionRef.current = null;
      setListening(false);
    };
    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch {
      toast.error("Couldn't start dictation — please try again");
    }
  };

  useEffect(() => () => recognitionRef.current?.abort(), []);
  useEffect(() => {
    if (active !== 1 && recognitionRef.current) stopDictation();
  }, [active]);

  const saveDictation = () => {
    const text = dictationText.trim();
    if (!text) return;
    if (listening) stopDictation();
    addText.mutate({ kind: "dictation", text }, { onSuccess: () => setDictationText("") });
  };

  // ── uploads ──
  const audioKey = jobKey(id, 1, "audio");
  const docKey = jobKey(id, 1, "document");
  const audioJob = useJob(audioKey);
  const docJob = useJob(docKey);
  const audioFile = usePendingVariables<File>(audioKey)[0];
  const docFile = usePendingVariables<File>(docKey)[0];

  const uploadAudio = useStudioMutation(audioKey, (file: File) => sermonApi.uploadAudio(id, file), {
    onSuccess: (res) => {
      addInput(res.input);
      toast.success("Recording transcribed", { description: "The transcript is now in your collected content." });
    },
    errorTitle: "Transcription failed",
  });
  const uploadDoc = useStudioMutation(docKey, (file: File) => sermonApi.uploadDocument(id, file), {
    onSuccess: (input) => {
      addInput(input);
      toast.success("Document added", { description: "Its text is now in your collected content." });
    },
    errorTitle: "Couldn't read that document",
  });

  const handleAudio = (file: File) => {
    const looksAudio = AUDIO_EXT.test(file.name) || (file.type.startsWith("audio/") && !/\.[a-z0-9]{2,5}$/i.test(file.name));
    if (!looksAudio) return void toast.error("Please choose an audio file", { description: "MP3, WAV, M4A, AAC, OGG, FLAC or WebM recordings are supported." });
    if (file.size > AUDIO_MAX_MB * 1024 * 1024) return void toast.error("Audio file too large", { description: "The maximum is 1 GB." });
    uploadAudio.mutate(file);
  };

  const handleDocument = (file: File) => {
    if (/\.doc$/i.test(file.name)) return void toast.error("Older Word files (.doc) aren't supported", { description: "Save it as .docx or PDF and upload that instead." });
    if (!DOC_EXT.test(file.name)) return void toast.error("Unsupported document", { description: "Use PDF, Word (.docx), plain text, Markdown or HTML." });
    if (file.size > DOC_MAX_MB * 1024 * 1024) return void toast.error("Document too large", { description: `The maximum is ${DOC_MAX_MB} MB.` });
    uploadDoc.mutate(file);
  };

  // ── Scripture references ──
  const addBible = useStudioMutation(jobKey(id, 1, "bible"), (v: { reference: string; notes?: string; translation?: string }) => sermonApi.addBibleRef(id, v), {
    onSuccess: (input) => {
      addInput(input);
      toast.success(`${input?.meta?.reference || "Scripture"} added`, { description: "The verse text is saved with your content." });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 422) setBibleError(err.message || "We couldn't find that reference. Check the book, chapter and verse.");
      else toastError(err, "Couldn't add the Scripture reference");
    },
  });

  const saveBible = () => {
    const reference = bibleVerse.trim();
    if (!reference || addBible.isPending) return;
    setBibleError(null);
    addBible.mutate(
      { reference, notes: bibleNotes.trim() || undefined, translation },
      {
        onSuccess: () => {
          setBibleVerse("");
          setBibleNotes("");
        },
      },
    );
  };

  // ── remove ──
  const removeInput = async (input: SermonInput) => {
    cache.patch((d) => ({ ...d, inputs: d.inputs.filter((i) => i.id !== input.id) }));
    try {
      await sermonApi.removeInput(id, input.id);
      toast.success("Removed from your content");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return;
      cache.patch((d) =>
        d.inputs.some((i) => i.id === input.id) ? d : { ...d, inputs: [...d.inputs, input].sort((a, b) => a.created_at.localeCompare(b.created_at)) },
      );
      toastError(err, "Couldn't remove that item");
    }
  };

  const totalWords = inputs.reduce((n, i) => n + describeInput(i).words, 0);
  const kindCounts = Object.entries(
    inputs.reduce<Record<string, number>>((acc, i) => {
      const label = (KIND_META[i.kind] ?? KIND_META.text).label;
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {}),
  );
  const keptLocally = <span className="text-xs text-ink-3">Not added yet — kept on this device until you add it.</span>;
  const busyTabs: Record<TabId, boolean> = { notes: false, dictate: listening, audio: audioJob.pending, document: docJob.pending, bible: false };

  return (
    <div className="grid grid-cols-1 gap-6">
      <StageIntro
        stage={1}
        aside={inputs.length > 0 ? <MetaPill tone="gold">{plural(inputs.length, "item")} · about {totalWords.toLocaleString()} words</MetaPill> : undefined}
      >
        {inputs.length === 0
          ? "Start by adding at least one thing: a few notes, your voice, a recording, a document or a Bible passage. Everything you add is combined when AI writes your draft."
          : "Add anything else that should shape this message, then continue to Polish when you're ready."}
      </StageIntro>

      <DetailsCard />

      <section aria-labelledby="collect-methods" className="rounded-2xl border border-border bg-card shadow-xs">
        <header className="flex items-start gap-3 px-4 pt-4 pb-1 sm:px-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gold-400/12 text-gold-600 dark:bg-gold-400/10 dark:text-gold-300" aria-hidden>
            <FilePlus className="size-[18px]" />
          </span>
          <div className="min-w-0 self-center">
            <h2 id="collect-methods" className="font-display text-lg leading-snug font-semibold tracking-tight text-ink">
              Add content
            </h2>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-2">Choose how you'd like to add something.</p>
          </div>
        </header>
        <Tabs.Root value={tab} onValueChange={(v) => setTab(v as TabId)}>
          <Tabs.List className="grid grid-cols-2 gap-2 px-4 pt-3 sm:grid-cols-3 sm:px-5 lg:grid-cols-5" aria-label="Ways to add content">
            {METHODS.map((m) => (
              <Tabs.Tab
                key={m.id}
                value={m.id}
                className={cn(
                  "group relative flex min-w-0 flex-col items-start gap-1.5 rounded-xl border border-border bg-surface p-3 text-left transition outline-none hover:border-gold-400/50 hover:bg-paper-2 focus-visible:ring-3 focus-visible:ring-ring dark:bg-surface-2/30 dark:hover:bg-surface-2/60",
                  "data-active:border-gold-500/70 data-active:bg-gold-400/10 data-active:ring-1 data-active:ring-gold-400/40 dark:data-active:bg-gold-400/10",
                  m.id === "bible" && "col-span-2 sm:col-span-1",
                )}
              >
                <span
                  className="grid size-9 place-items-center rounded-lg bg-surface-2 text-ink-2 transition group-data-active:bg-gold-400 group-data-active:text-navy-900"
                  aria-hidden
                >
                  <m.icon className="size-[18px]" />
                </span>
                <span className="text-sm font-semibold text-ink">{m.label}</span>
                <span className="hidden text-xs leading-snug text-ink-3 sm:block">{m.desc}</span>
                {busyTabs[m.id] && (
                  <span
                    className={cn("absolute top-3 right-3 size-2 rounded-full", m.id === "dictate" ? "animate-pulse bg-red-500" : "animate-pulse bg-gold-500")}
                    aria-label={m.id === "dictate" ? "listening" : "working"}
                  />
                )}
              </Tabs.Tab>
            ))}
          </Tabs.List>

          <Tabs.Panel value="notes" className="grid grid-cols-1 gap-3 p-4 outline-none sm:p-5">
            <p className="text-sm text-ink-2">Type or paste your outline, study notes, stories and illustrations — rough is fine.</p>
            <TextArea
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder="e.g. Main idea: hope anchors us in storms. Story: my grandfather's fishing boat…"
              aria-label="Sermon notes"
              className="min-h-[200px]"
            />
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              {typedText ? <span className="text-xs text-ink-3">{plural(countWords(typedText), "word")} · kept on this device until you add it</span> : <span />}
              <Button onClick={saveTyped} disabled={!typedText.trim() || savingKind === "text"} className="h-11 gap-2 rounded-xl px-5 sm:h-10">
                {savingKind === "text" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Add notes
              </Button>
            </div>
          </Tabs.Panel>

          <Tabs.Panel value="dictate" className="grid grid-cols-1 gap-3 p-4 outline-none sm:p-5">
            <p className="text-sm text-ink-2">Press start and talk through your ideas — your words are written down as you speak. Review them, then add them.</p>
            {!speechSupported && (
              <Notice tone="warn">Live dictation needs a browser with speech recognition, such as Chrome, Edge or Safari. You can still type here, or upload a recording.</Notice>
            )}
            <div className="relative">
              <TextArea
                value={dictationText}
                onChange={(e) => setDictationText(e.target.value)}
                readOnly={listening}
                placeholder={listening ? "Listening… start speaking" : "Press “Start speaking” and your words will appear here…"}
                aria-label="Spoken notes"
                className={cn("min-h-[200px]", listening && "border-red-500/50 ring-3 ring-red-500/15")}
              />
              {listening && (
                <span
                  className="pointer-events-none absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm"
                  role="status"
                >
                  <span className="size-2 animate-pulse rounded-full bg-white" aria-hidden /> Listening
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                variant={listening ? "destructive" : "outline"}
                onClick={listening ? stopDictation : startDictation}
                disabled={!speechSupported && !listening}
                aria-pressed={listening}
                className="h-11 gap-2 rounded-xl px-5 sm:h-10"
              >
                {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                {listening ? "Stop" : dictationText ? "Keep speaking" : "Start speaking"}
              </Button>
              <Button onClick={saveDictation} disabled={!dictationText.trim() || savingKind === "dictation"} className="h-11 gap-2 rounded-xl px-5 sm:h-10">
                {savingKind === "dictation" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Add spoken notes
              </Button>
              {dictationText && !listening && (
                <Button variant="ghost" onClick={() => setConfirmClear(true)} className="h-11 rounded-xl px-3 text-ink-3 hover:text-ink sm:h-10">
                  Clear
                </Button>
              )}
            </div>
          </Tabs.Panel>

          <Tabs.Panel value="audio" className="grid grid-cols-1 gap-3 p-4 outline-none sm:p-5">
            <p className="text-sm text-ink-2">Upload a sermon recording or a voice memo. It's transcribed for you and the words are added to your content.</p>
            <DropZone
              accept={AUDIO_ACCEPT}
              icon={<AudioLines className="size-6" />}
              title="Drop a recording here, or choose one"
              hint="MP3, WAV, M4A, AAC, OGG, FLAC or WebM · long recordings are fine"
              busy={audioJob.pending}
              busyLabel={audioFile ? `Transcribing “${audioFile.name}”…` : "Transcribing…"}
              busyHint="A long recording can take a few minutes. You can keep working — we'll let you know when it's done."
              onFile={handleAudio}
              label="Choose a recording"
            />
          </Tabs.Panel>

          <Tabs.Panel value="document" className="grid grid-cols-1 gap-3 p-4 outline-none sm:p-5">
            <p className="text-sm text-ink-2">Upload study material, research or an old outline. The text is pulled out and added to your content.</p>
            <DropZone
              accept={DOC_ACCEPT}
              icon={<FileUp className="size-6" />}
              title="Drop a document here, or choose one"
              hint={`PDF, Word (.docx), plain text, Markdown or HTML · up to ${DOC_MAX_MB} MB`}
              busy={docJob.pending}
              busyLabel={docFile ? `Reading “${docFile.name}”…` : "Reading your document…"}
              busyHint="This usually takes a few seconds."
              onFile={handleDocument}
              label="Choose a document"
            />
          </Tabs.Panel>

          <Tabs.Panel value="bible" className="grid grid-cols-1 gap-4 p-4 outline-none sm:p-5">
            <p className="text-sm text-ink-2">Add a passage and any study notes. The verse text is looked up for you and used when your draft is written.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
              <div>
                <FieldLabel htmlFor="bible-ref">Bible passage</FieldLabel>
                <TextInput
                  id="bible-ref"
                  value={bibleVerse}
                  onChange={(e) => {
                    setBibleVerse(e.target.value);
                    if (bibleError) setBibleError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveBible();
                    }
                  }}
                  placeholder="e.g. John 3:16-17 or Romans 8:28"
                  aria-invalid={!!bibleError}
                  aria-describedby={bibleError ? "bible-ref-error" : undefined}
                  autoComplete="off"
                />
              </div>
              <div>
                <FieldLabel htmlFor="bible-translation">Translation</FieldLabel>
                <NativeSelect id="bible-translation" value={translation} onChange={(e) => setTranslation(e.target.value)}>
                  {(translations.data?.length ? translations.data : [{ id: "web", abbreviation: "WEB", name: "World English Bible" }]).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.abbreviation} — {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            {bibleError && (
              <p id="bible-ref-error" role="alert" className="-mt-1 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-danger">
                {bibleError}
              </p>
            )}
            <div>
              <p className="mb-2 text-xs font-medium text-ink-3">Or pick a well-known passage</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_REFS.map((ref) => (
                  <button
                    key={ref}
                    type="button"
                    aria-pressed={bibleVerse === ref}
                    onClick={() => {
                      setBibleVerse(ref);
                      setBibleError(null);
                    }}
                    className={cn(
                      "h-9 rounded-full border px-3 text-[13px] transition outline-none focus-visible:ring-3 focus-visible:ring-ring sm:h-8",
                      bibleVerse === ref ? "border-gold-500/70 bg-gold-400/10 text-ink" : "border-border text-ink-2 hover:border-gold-400/60 hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    {ref}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <FieldLabel htmlFor="bible-notes" hint="Optional">
                Study notes
              </FieldLabel>
              <TextArea
                id="bible-notes"
                value={bibleNotes}
                onChange={(e) => setBibleNotes(e.target.value)}
                placeholder="Context, cross-references, Greek or Hebrew insights, application ideas…"
                className="min-h-24"
              />
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              {bibleVerse || bibleNotes ? keptLocally : <span />}
              <Button onClick={saveBible} disabled={!bibleVerse.trim() || addBible.isPending} className="h-11 gap-2 rounded-xl px-5 sm:h-10">
                {addBible.isPending ? <Loader2 className="size-4 animate-spin" /> : <BookOpen className="size-4" />} Add Scripture
              </Button>
            </div>
          </Tabs.Panel>
        </Tabs.Root>
      </section>

      <SectionCard
        icon={Inbox}
        title="Your collected content"
        description={
          inputs.length
            ? `${plural(inputs.length, "item")} · about ${totalWords.toLocaleString()} words — all of it is used when your draft is written.`
            : "Everything you add appears here, ready to be polished into a sermon."
        }
        action={
          kindCounts.length > 1 ? (
            <div className="hidden flex-wrap gap-1.5 md:flex">
              {kindCounts.map(([label, n]) => (
                <MetaPill key={label}>
                  {label} × {n}
                </MetaPill>
              ))}
            </div>
          ) : undefined
        }
      >
        {inputs.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-surface-2 text-ink-3" aria-hidden>
              <Inbox className="size-5" />
            </span>
            <p className="mt-3 font-medium text-ink">Nothing collected yet</p>
            <p className="mt-1 max-w-sm text-sm text-ink-3">Choose one of the options above — even a single Bible passage is enough to get started.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2.5">
            {inputs.map((input) => (
              <InputRow key={input.id} input={input} onRemove={() => void removeInput(input)} />
            ))}
          </ul>
        )}
      </SectionCard>

      <StageFooter
        hint={
          inputs.length === 0 ? (
            "Add at least one note, recording, document or Scripture passage to continue."
          ) : (
            <>
              <span className="font-medium text-ink-2">Next: Polish.</span> AI turns your {plural(inputs.length, "item")} into a clear sermon you can edit.
            </>
          )
        }
      >
        <Button onClick={() => goToStage(2)} disabled={inputs.length === 0} className="h-12 w-full gap-2 rounded-xl px-6 text-[15px] font-semibold sm:w-auto">
          Continue to Polish <ArrowRight className="size-4" />
        </Button>
      </StageFooter>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear your spoken notes?"
        description="The words you dictated haven't been added yet, so they'll be lost."
        confirmLabel="Clear text"
        destructive
        icon={Trash2}
        onConfirm={() => {
          setDictationText("");
          setConfirmClear(false);
        }}
      />
    </div>
  );
}

function DetailsCard() {
  const { sermon, saveMeta } = useWorkspace();
  const title = useCommitField(sermon.title, (v) => void saveMeta({ title: v }).catch(() => undefined), { required: true });
  const scripture = useCommitField(sermon.scripture_ref, (v) => void saveMeta({ scripture_ref: v || null }).catch(() => undefined));
  const theme = useCommitField(sermon.theme, (v) => void saveMeta({ theme: v || null }).catch(() => undefined));
  return (
    <SectionCard icon={NotebookPen} title="Sermon details" description="These guide the AI when it writes your draft. Changes save automatically.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
        <div className="sm:col-span-2 lg:col-span-5">
          <FieldLabel htmlFor="sermon-title">Title</FieldLabel>
          <TextInput id="sermon-title" {...title} placeholder="Sermon title" maxLength={200} />
        </div>
        <div className="lg:col-span-3">
          <FieldLabel htmlFor="sermon-scripture">Key Scripture</FieldLabel>
          <TextInput id="sermon-scripture" {...scripture} placeholder="e.g. John 3:16" maxLength={200} />
        </div>
        <div className="lg:col-span-4">
          <FieldLabel htmlFor="sermon-theme" hint="Optional">
            Big idea
          </FieldLabel>
          <TextInput id="sermon-theme" {...theme} placeholder="e.g. God's love never lets go" maxLength={300} />
        </div>
      </div>
    </SectionCard>
  );
}

function DropZone({
  accept,
  icon,
  title,
  hint,
  busy,
  busyLabel,
  busyHint,
  onFile,
  label,
}: {
  accept: string;
  icon: ReactNode;
  title: string;
  hint: string;
  busy: boolean;
  busyLabel: string;
  busyHint: string;
  onFile: (file: File) => void;
  label: string;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !busy) onFile(file);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-5 py-10 text-center transition",
        busy ? "border-gold-400/50 bg-gold-400/5" : over ? "border-gold-500 bg-gold-400/10" : "border-border hover:border-gold-400/50",
      )}
    >
      <span className="grid size-14 place-items-center rounded-full bg-gold-400/12 text-gold-600 dark:text-gold-300" aria-hidden>
        {busy ? <Loader2 className="size-6 animate-spin" /> : icon}
      </span>
      <div role={busy ? "status" : undefined} aria-live="polite" className="max-w-md">
        <p className="font-medium break-words text-ink">{busy ? busyLabel : title}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-3">{busy ? busyHint : hint}</p>
      </div>
      {!busy && (
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} className="h-11 gap-2 rounded-xl px-5 sm:h-10">
          <Upload className="size-4" /> {label}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

function InputRow({ input, onRemove }: { input: SermonInput; onRemove: () => void }) {
  const meta = KIND_META[input.kind] ?? KIND_META.text;
  const Icon = meta.icon;
  const { title, verse, body, words } = describeInput(input);
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(t);
  }, [confirming]);
  const long = (body?.length ?? 0) > 280 || (body?.split("\n").length ?? 0) > 4 || (verse?.length ?? 0) > 320;
  const label = title ?? meta.label.toLowerCase();

  return (
    <li className={cn("rounded-xl border border-border bg-paper-2/70 p-3 transition sm:p-4 dark:bg-surface-2/30", confirming && "border-danger/40")}>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", meta.className)} aria-hidden>
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1 self-center">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{meta.label}</span>
            <span className="text-xs text-ink-3">· {timeAgo(input.created_at)}</span>
            {words > 0 && <span className="text-xs text-ink-3">· {plural(words, "word")}</span>}
          </div>
          {title && <p className="mt-0.5 truncate text-[15px] font-semibold text-ink">{title}</p>}
        </div>
        {!confirming && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setConfirming(true)}
            aria-label={`Remove ${label}`}
            title="Remove"
            className="size-10 shrink-0 rounded-lg text-ink-3 hover:text-danger sm:size-9"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      {/* Content spans the full card on phones and lines up with the title on wider screens. */}
      <div className="mt-2 min-w-0 sm:pl-[3.25rem]">
        {verse && (
          <blockquote className={cn("border-l-2 border-gold-400 pl-3 font-serif text-[15px] leading-relaxed text-ink", !expanded && "line-clamp-4")}>{verse}</blockquote>
        )}
        {body && (
          <p className={cn("text-sm leading-relaxed whitespace-pre-line text-ink-2", verse && "mt-1.5", !expanded && "line-clamp-3")}>
            {verse && <span className="font-medium text-ink-3">Notes: </span>}
            {body}
          </p>
        )}
        {!verse && !body && <p className="text-sm text-ink-3 italic">No text could be read from this item.</p>}
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 inline-flex h-9 items-center gap-1 rounded-lg text-xs font-semibold text-link outline-none focus-visible:ring-3 focus-visible:ring-ring"
            aria-expanded={expanded}
          >
            <ChevronDown className={cn("size-3.5 transition", expanded && "rotate-180")} aria-hidden /> {expanded ? "Show less" : "Show all"}
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3" role="alertdialog" aria-label={`Remove ${label}?`}>
          <span className="mr-auto text-sm text-ink-2">Remove this from your content? This can't be undone.</span>
          <Button variant="ghost" onClick={() => setConfirming(false)} className="h-10 gap-1.5 rounded-lg px-3 sm:h-9">
            <X className="size-4" /> Keep
          </Button>
          <Button variant="destructive" onClick={onRemove} className="h-10 gap-1.5 rounded-lg px-3 sm:h-9">
            <Trash2 className="size-4" /> Remove
          </Button>
        </div>
      )}
    </li>
  );
}
