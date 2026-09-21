/** Parts of a recording. Only the message is mapped to verses and clipped; the rest is labelled and left alone. */
export const PART_LABELS: Record<string, string> = {
  message: "Message",
  worship: "Worship",
  welcome: "Welcome",
  announcements: "Announcements",
  prayer: "Prayer",
  scripture_reading: "Scripture reading",
  communion: "Communion",
  testimony: "Testimony",
  other: "Other",
};

export function partLabel(part?: string | null): string {
  if (!part) return PART_LABELS.message;
  return PART_LABELS[part] ?? part.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function isMessage(part?: string | null): boolean {
  return !part || part === "message";
}

/** "Worship · 12 · Welcome · 4" style summary of a recording's parts, message first. */
export function partsSummary(parts?: Record<string, number> | null): { label: string; count: number }[] {
  if (!parts) return [];
  return Object.entries(parts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => (a[0] === "message" ? -1 : b[0] === "message" ? 1 : b[1] - a[1]))
    .map(([part, count]) => ({ label: partLabel(part), count }));
}
