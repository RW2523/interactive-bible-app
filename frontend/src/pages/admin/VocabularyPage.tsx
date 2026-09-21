import { CalendarDays, CircleHelp, HeartHandshake, Loader2, MapPin, Pencil, Plus, Search, Tags, UserRound, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useBooks, useEntities, useInvalidate, useTopics } from "@/api/hooks";
import type { Json } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { canonicalRef } from "./adminApi";
import {
  ADMIN_PAGE, CardListSkeleton, ChoiceCards, EmptyState, ErrorCard, errorMessage, Field, FilterTabs, NativeSelect, Notice, PageHeader, StatusPill, TextArea, TextInput, Toggle,
} from "./AdminUI";
import { humanize, prettyRef } from "./adminLabels";

type Tab = "topics" | "entities";

const ENTITY_TYPES: Record<string, { label: string; plural: string; icon: LucideIcon; description: string }> = {
  person: { label: "Person", plural: "People", icon: UserRound, description: "Someone in the Bible, like Paul or Ruth." },
  place: { label: "Place", plural: "Places", icon: MapPin, description: "A city, region or landmark, like Jerusalem." },
  event: { label: "Event", plural: "Events", icon: CalendarDays, description: "Something that happened, like the Exodus." },
  life_situation: { label: "Life situation", plural: "Life situations", icon: HeartHandshake, description: "Something people go through, like grief or a new job." },
  question: { label: "Question", plural: "Questions", icon: CircleHelp, description: "A question people ask, like “Why does God allow suffering?”" },
};

const CATEGORY_LABELS: Record<string, string> = {
  christian_life: "Christian life",
  theology: "Theology",
  virtue: "Virtues",
  struggle: "Struggles",
  practice: "Practices",
  relationship: "Relationships",
  eschatology: "End times",
  mission: "Mission",
  custom: "Custom",
};

const categoryName = (c?: string | null) => (c ? CATEGORY_LABELS[c] ?? humanize(c) : "—");

export function VocabularyPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "entities" ? "entities" : "topics";
  const topics = useTopics();
  const entities = useEntities();
  const books = useBooks();
  const bookNames = useMemo(() => Object.fromEntries((books.data || []).map((b) => [b.code, b.name])), [books.data]);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [editing, setEditing] = useState<Json | null>(null);
  const [limit, setLimit] = useState(60);

  const source = tab === "topics" ? topics : entities;
  const rows: Json[] = source.data || [];
  const groupKey = tab === "topics" ? "category" : "type";
  const groups = [...new Set(rows.map((r) => r[groupKey]).filter(Boolean))].sort();
  const q = query.trim().toLowerCase();
  const matching = rows
    .filter((r) => !group || r[groupKey] === group)
    .filter((r) => !q || String(r.name).toLowerCase().includes(q) || (r.aliases || []).some((a: string) => a.toLowerCase().includes(q)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const visible = matching.slice(0, limit);

  const switchTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === "topics") next.delete("tab");
    else next.set("tab", t);
    setParams(next, { replace: true });
    setGroup("");
    setLimit(60);
  };

  return (
    <div className={ADMIN_PAGE}>
      <PageHeader
        icon={Tags}
        eyebrow="Insights & settings"
        title="Topics & entities"
        description="The themes, people, places, events and life situations used to tag sections, power search and draw the Scripture Map."
        actions={
          <Button onClick={() => setEditing({})} className="h-10 gap-2 rounded-xl px-4">
            <Plus className="size-4" aria-hidden /> {tab === "topics" ? "Add a topic" : "Add an entry"}
          </Button>
        }
      />

      <FilterTabs<Tab>
        label="Vocabulary"
        value={tab}
        onChange={switchTab}
        className="mb-4"
        options={[
          { value: "topics", label: "Topics", count: topics.data?.length ?? null },
          { value: "entities", label: "People, places & events", count: entities.data?.length ?? null },
        ]}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
          <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "topics" ? "Search topics or other names" : "Search names or other names"} aria-label="Search" className="bg-card pl-9" />
        </div>
        <NativeSelect value={group} onChange={(e) => setGroup(e.target.value)} aria-label={tab === "topics" ? "Category" : "Kind"} wrapperClassName="sm:w-60" className="bg-card">
          <option value="">{tab === "topics" ? "All categories" : "All kinds"}</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {tab === "topics" ? categoryName(g) : ENTITY_TYPES[g]?.plural ?? humanize(g)}
            </option>
          ))}
        </NativeSelect>
      </div>

      {source.error && !source.data ? (
        <ErrorCard error={source.error} onRetry={() => void source.refetch()} retrying={source.isFetching} />
      ) : source.isLoading ? (
        <CardListSkeleton rows={6} />
      ) : matching.length === 0 ? (
        <EmptyState
          icon={Search}
          title={rows.length ? "Nothing matches" : tab === "topics" ? "No topics yet" : "No entries yet"}
          action={
            <Button onClick={() => setEditing(q ? { name: query.trim() } : {})} className="h-10 gap-2 rounded-xl px-4">
              <Plus className="size-4" aria-hidden /> {q ? `Add “${query.trim()}”` : tab === "topics" ? "Add a topic" : "Add an entry"}
            </Button>
          }
        >
          {rows.length ? "Try another search, or add it now." : "Add the first one to start tagging sections."}
        </EmptyState>
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-2" aria-live="polite">
            {matching.length === rows.length ? `${rows.length}` : `${matching.length} of ${rows.length}`} {tab === "topics" ? "topics" : "entries"}
          </p>
          {/* wide screens: table */}
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-xs md:block">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-surface-2/60 text-left text-xs text-ink-2">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Name</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">{tab === "topics" ? "Category" : "Kind"}</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Also known as</th>
                  {tab === "entities" && <th scope="col" className="px-4 py-2.5 font-semibold">Key passages</th>}
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Used in</th>
                  <th scope="col" className="w-12 px-2 py-2.5">
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top transition hover:bg-surface-2/40">
                    <th scope="row" className="px-4 py-3 text-left font-semibold text-ink">
                      {r.name}
                      {r.description && <span className="mt-0.5 block text-xs font-normal text-ink-2">{r.description}</span>}
                    </th>
                    <td className="px-4 py-3 text-ink-2">{tab === "topics" ? categoryName(r.category) : ENTITY_TYPES[r.type]?.label ?? humanize(r.type)}</td>
                    <td className="max-w-72 px-4 py-3 text-ink-2">{(r.aliases || []).join(", ") || "—"}</td>
                    {tab === "entities" && (
                      <td className="px-4 py-3 text-ink-2">
                        {(r.passages || []).map((p: string) => prettyRef(p, bookNames)).join("; ") || "—"}
                        {r.link_passages && (r.passages || []).length > 0 && <span className="mt-0.5 block text-xs text-ink-2">Mentions link to these passages</span>}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right whitespace-nowrap text-ink tabular-nums">
                      {r.usage} {Number(r.usage) === 1 ? "section" : "sections"}
                    </td>
                    <td className="px-2 py-2">
                      <Button variant="ghost" onClick={() => setEditing(r)} className="h-10 w-10 rounded-xl p-0" aria-label={`Edit ${r.name}`}>
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* phones: cards */}
          <ul className="grid grid-cols-1 gap-2.5 md:hidden">
            {visible.map((r) => {
              const Icon = tab === "entities" ? ENTITY_TYPES[r.type]?.icon ?? Tags : Tags;
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => setEditing(r)} className="flex w-full items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-xs transition hover:border-gold-400/50">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold-400/15 text-gold-700 dark:text-gold-300" aria-hidden>
                      <Icon className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{r.name}</span>
                        <StatusPill tone="neutral">
                          {r.usage} {Number(r.usage) === 1 ? "section" : "sections"}
                        </StatusPill>
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-2">{tab === "topics" ? categoryName(r.category) : ENTITY_TYPES[r.type]?.label ?? humanize(r.type)}</span>
                      {(r.aliases || []).length > 0 && <span className="mt-1 block text-xs text-ink-2">Also: {(r.aliases || []).slice(0, 6).join(", ")}</span>}
                      {tab === "entities" && (r.passages || []).length > 0 && <span className="mt-1 block text-xs text-ink-2">Passages: {(r.passages || []).map((p: string) => prettyRef(p, bookNames)).join("; ")}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {matching.length > visible.length && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={() => setLimit((l) => l + 60)} className="h-10 rounded-xl bg-card px-4">
                Show more ({matching.length - visible.length} left)
              </Button>
            </div>
          )}
        </>
      )}

      {editing && <VocabularyDialog tab={tab} item={editing} categories={groups} bookNames={bookNames} onClose={() => setEditing(null)} />}
    </div>
  );
}

function VocabularyDialog({ tab, item, categories, bookNames, onClose }: { tab: Tab; item: Json; categories: string[]; bookNames: Record<string, string>; onClose: () => void }) {
  const invalidate = useInvalidate();
  const isNew = !item.id;
  const [form, setForm] = useState({
    name: (item.name || "") as string,
    category: (item.category || (categories.includes("christian_life") ? "christian_life" : categories[0] || "custom")) as string,
    newCategory: "",
    type: (item.type || "person") as string,
    aliases: ((item.aliases || []) as string[]).join(", "),
    passages: ((item.passages || []) as string[]).map((p) => prettyRef(p, bookNames)).join("; "),
    link_passages: !!item.link_passages,
    description: (item.description || "") as string,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Enter a name.";
    if (tab === "topics" && form.category === "__new" && !form.newCategory.trim()) e.newCategory = "Name the new category.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const aliases = form.aliases.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      let body: Json;
      if (tab === "topics") {
        const category = form.category === "__new" ? form.newCategory.trim().toLowerCase().replace(/\s+/g, "_") : form.category;
        body = { id: item.id, slug: item.slug, name: form.name.trim(), category, aliases, description: form.description.trim() || null };
      } else {
        const parts = form.passages.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
        // passages shown unchanged keep their exact stored form (the reference parser can't read every range back)
        const original = new Map(((item.passages || []) as string[]).map((p) => [prettyRef(p, bookNames), p]));
        const passages: string[] = [];
        for (const part of parts) {
          const kept = original.get(part);
          const canonical = kept ?? (await canonicalRef(part));
          const looksLikeRange = /\d\s*[-–—]\s*\S/.test(part);
          if (!canonical || (!kept && looksLikeRange && !canonical.includes("-"))) {
            setErrors({
              passages: canonical
                ? `“${part}” was only partly understood. Use a range within one book, like Luke 15:11-32, or list the parts separately.`
                : `“${part}” isn't a Bible reference we recognise. Try something like Luke 15:11-32.`,
            });
            setSaving(false);
            return;
          }
          passages.push(canonical);
        }
        body = { id: item.id, key: item.key, name: form.name.trim(), type: form.type, aliases, passages, link_passages: form.link_passages && passages.length > 0, description: form.description.trim() || null };
      }
      await api(`/v1/admin/${tab}`, { method: "POST", body });
      toast.success(isNew ? `Added “${form.name.trim()}”` : `Saved “${form.name.trim()}”`);
      invalidate("topics", "entities", "audit");
      onClose();
    } catch (err) {
      setErrors({ form: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const noun = tab === "topics" ? "topic" : "entry";
  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border p-5">
          <DialogTitle className="font-display text-xl">{isNew ? `Add a ${noun}` : `Edit “${item.name}”`}</DialogTitle>
          <DialogDescription>
            {tab === "topics"
              ? "Topics are themes like Hope or Forgiveness. Sections that talk about them are tagged automatically the next time items are processed."
              : "People, places, events and life situations help link sections to the right passages and fill the Scripture Map."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-5 p-5">
          <Field label="Name" htmlFor="vocab-name" error={errors.name}>
            <TextInput id="vocab-name" value={form.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} placeholder={tab === "topics" ? "e.g. Hope" : "e.g. The Prodigal Son"} autoFocus={isNew} />
          </Field>
          {tab === "topics" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Category" htmlFor="vocab-category">
                <NativeSelect id="vocab-category" value={form.category} onChange={(e) => set("category", e.target.value)}>
                  {[...new Set([...categories, form.category])].filter((c) => c && c !== "__new").map((c) => (
                    <option key={c} value={c}>{categoryName(c)}</option>
                  ))}
                  <option value="__new">New category…</option>
                </NativeSelect>
              </Field>
              {form.category === "__new" && (
                <Field label="New category name" htmlFor="vocab-new-category" error={errors.newCategory}>
                  <TextInput id="vocab-new-category" value={form.newCategory} onChange={(e) => set("newCategory", e.target.value)} placeholder="e.g. Worship" />
                </Field>
              )}
            </div>
          ) : (
            <ChoiceCards
              name="vocab-type"
              legend="What kind of entry is it?"
              value={form.type}
              onChange={(v) => set("type", v)}
              options={Object.entries(ENTITY_TYPES).map(([value, t]) => ({ value, label: t.label, description: t.description, icon: t.icon }))}
            />
          )}
          <Field label="Also known as" htmlFor="vocab-aliases" optional hint="Other words or spellings people use, separated by commas — e.g. worry, anxious, worried.">
            <TextInput id="vocab-aliases" value={form.aliases} onChange={(e) => set("aliases", e.target.value)} />
          </Field>
          {tab === "entities" && (
            <div className="grid grid-cols-1 gap-3 rounded-2xl border border-border p-4">
              <Field label="Key passages" htmlFor="vocab-passages" optional error={errors.passages} hint="Separate with semicolons — e.g. Luke 15:11-32; Genesis 22.">
                <TextInput id="vocab-passages" value={form.passages} onChange={(e) => set("passages", e.target.value)} aria-invalid={!!errors.passages} />
              </Field>
              <Toggle
                checked={form.link_passages}
                onChange={(v) => set("link_passages", v)}
                label="Link mentions to these passages"
                description="When a sermon mentions this by name, it's linked to the passages as a story or passage reference."
              />
            </div>
          )}
          <Field label="Short description" htmlFor="vocab-description" optional>
            <TextArea id="vocab-description" value={form.description} onChange={(e) => set("description", e.target.value)} className="min-h-20" />
          </Field>
          {!isNew && (
            <p className="text-sm text-ink-2">
              Used in <span className="font-semibold text-ink">{item.usage}</span> {Number(item.usage) === 1 ? "section" : "sections"}. Renaming keeps those tags.
            </p>
          )}
          {errors.form && (
            <Notice tone="danger" title="Couldn't save">
              {errors.form}
            </Notice>
          )}
        </div>
        <DialogFooter className={cn("sticky bottom-0 m-0 rounded-none border-t border-border bg-card p-4")}>
          <Button variant="ghost" onClick={onClose} disabled={saving} className="h-10 rounded-xl px-4">
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving} className="h-10 gap-2 rounded-xl px-4">
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />} {isNew ? `Add ${noun}` : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
