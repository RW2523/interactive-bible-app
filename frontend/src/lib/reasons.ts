import { BadgeCheck, BookOpen, Library, MessageSquareQuote, Sparkles, Tags, Type, Users, type LucideIcon } from "lucide-react";

export interface ReasonChip {
  label: string;
  icon: LucideIcon;
}

/** Turn a search "reason" from the API into a short, plain-language chip (or null when it's a free-text explanation). */
export function friendlyReason(reason: string): ReasonChip | null {
  if (/^Exact reference/i.test(reason)) return { label: "Exact reference", icon: BookOpen };
  if (/^Direct mention of/i.test(reason)) return { label: reason.replace(/^Direct mention of/i, "Names"), icon: MessageSquareQuote };
  if (/^Discusses all the passages/i.test(reason)) return { label: "Covers every passage you named", icon: BookOpen };
  if (/^Semantic match/i.test(reason)) return { label: "Similar meaning", icon: Sparkles };
  if (/^Keyword match/i.test(reason)) return { label: /all terms/i.test(reason) ? "Uses all your words" : "Uses your words", icon: Type };
  if (/Key verse for this theme/i.test(reason)) return { label: "Key verse for this theme", icon: Tags };
  if (/matching theme/i.test(reason)) return { label: "Matching theme", icon: Tags };
  if (/^Within a passage about/i.test(reason)) return { label: reason.replace(/^Within a passage about/i, "About"), icon: Users };
  if (/^About /i.test(reason) && reason.length < 60) return { label: reason, icon: Tags };
  if (/Explained in library/i.test(reason)) return { label: "Explained in your library", icon: Library };
  if (/Human-verified/i.test(reason)) return { label: "Verified by an editor", icon: BadgeCheck };
  return null;
}

/** Split reasons into chips and (at most one) free-text explanation sentence. */
export function splitReasons(reasons: string[] | undefined | null): { chips: ReasonChip[]; explanation: string | null } {
  const chips: ReasonChip[] = [];
  let explanation: string | null = null;
  for (const r of reasons || []) {
    const chip = friendlyReason(r);
    if (chip) {
      if (!chips.some((c) => c.label === chip.label)) chips.push(chip);
    } else if (!explanation && r.trim().length > 0) {
      explanation = r.trim();
    }
  }
  return { chips, explanation };
}
