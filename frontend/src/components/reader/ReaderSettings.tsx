import { Minus, Plus, Type } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { Translation } from "@/api/types";
import { SegmentedControl } from "@/components/page";

export const MIN_READING_SIZE = 15;
export const MAX_READING_SIZE = 28;

/** "Aa" — text size, resource markers and (on phones) translation. */
export function ReaderSettings({
  size, onSize, markers, onMarkers, translation, translations, onTranslation,
}: {
  size: number;
  onSize: (size: number) => void;
  markers: boolean;
  onMarkers: (on: boolean) => void;
  translation: string;
  translations: Pick<Translation, "id" | "abbreviation" | "name">[];
  onTranslation: (id: string) => void;
}) {
  const current = translations.find((t) => t.id === translation);
  return (
    <Popover>
      <PopoverTrigger
        className="grid grid-cols-1 size-10 shrink-0 place-items-center rounded-xl border border-border bg-card text-ink-2 shadow-xs transition outline-none hover:border-line-2 hover:bg-surface-2 hover:text-ink focus-visible:ring-3 focus-visible:ring-ring data-popup-open:bg-surface-2 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
        aria-label="Reading settings: text size, markers and translation"
      >
        <Type className="size-[18px]" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-0">
        <div className="border-b border-border px-4 py-3">
          <div className="font-display text-base font-semibold text-ink">Reading settings</div>
          <p className="text-xs text-ink-3">Saved on this device.</p>
        </div>
        <div className="grid grid-cols-1 gap-5 p-4">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm font-medium text-ink">
              Text size <span className="text-xs font-normal text-ink-3 tabular-nums">{size}px</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSize(Math.max(MIN_READING_SIZE, size - 1))}
                disabled={size <= MIN_READING_SIZE}
                className="grid grid-cols-1 size-10 place-items-center rounded-xl border border-border bg-card text-ink-2 transition hover:bg-surface-2 disabled:opacity-40 dark:bg-white/[0.04]"
                aria-label="Smaller text"
              >
                <Minus className="size-4" aria-hidden />
              </button>
              <input
                type="range"
                min={MIN_READING_SIZE}
                max={MAX_READING_SIZE}
                step={1}
                value={size}
                onChange={(e) => onSize(Number(e.target.value))}
                aria-label="Text size"
                className="h-2 min-w-0 flex-1 cursor-pointer accent-[var(--primary)]"
              />
              <button
                type="button"
                onClick={() => onSize(Math.min(MAX_READING_SIZE, size + 1))}
                disabled={size >= MAX_READING_SIZE}
                className="grid grid-cols-1 size-10 place-items-center rounded-xl border border-border bg-card text-ink-2 transition hover:bg-surface-2 disabled:opacity-40 dark:bg-white/[0.04]"
                aria-label="Larger text"
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
            <p className="mt-3 rounded-xl bg-surface-2/60 px-3 py-2 font-serif text-ink dark:bg-white/[0.04]" style={{ fontSize: size, lineHeight: 1.6 }}>
              In the beginning was the Word.
            </p>
          </div>

          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">Show insight markers</span>
              <span className="mt-0.5 block text-xs/relaxed text-ink-3">A small gold dot marks verses that sermons, podcasts or studies in your library talk about.</span>
            </span>
            <Switch checked={markers} onCheckedChange={(v) => onMarkers(v)} aria-label="Show insight markers" className="mt-0.5" />
          </label>

          {translations.length > 1 && (
            <div>
              <div className="mb-2 text-sm font-medium text-ink">Translation</div>
              <SegmentedControl
                ariaLabel="Translation"
                value={translation}
                onChange={onTranslation}
                options={translations.map((t) => ({ value: t.id, label: t.abbreviation, title: t.name }))}
                className="w-full [&>button]:flex-1"
              />
              {current && <p className="mt-1.5 text-xs text-ink-3">{current.name}</p>}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
