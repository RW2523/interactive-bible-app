import { Flag, MoreHorizontal, ThumbsDown, ThumbsUp, Timer, BookX, Quote } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useFeedback } from "../api/hooks";
import { useAuth } from "../auth/AuthContext";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";

type ObjectType = "mapping" | "segment" | "resource" | "verse_relationship";

const OPTIONS = [
  { kind: "helpful", label: "Helpful connection", icon: ThumbsUp },
  { kind: "not_relevant", label: "Not relevant", icon: ThumbsDown },
  { kind: "wrong_verse", label: "Wrong verse", icon: BookX },
  { kind: "wrong_timestamp", label: "Wrong timestamp", icon: Timer },
  { kind: "wrong_quote_reference", label: "Wrong quote or reference", icon: Quote },
] as const;

export function FeedbackMenu({ objectType, objectId, small = true }: { objectType: ObjectType; objectId: string | null | undefined; small?: boolean }) {
  const feedback = useFeedback();
  const { isEditor } = useAuth();
  const [reportOpen, setReportOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!objectId) return null;

  const send = (kind: string, text?: string) =>
    feedback.mutate(
      { object_type: objectType, object_id: objectId, kind, note: text },
      {
        onSuccess: (r) =>
          toast.success(
            r?.status === "duplicate_ignored" ? "We already have your report" : kind === "helpful" ? "Thanks for the feedback" : "Thanks — this will be reviewed",
            kind === "helpful" || r?.status === "duplicate_ignored" ? undefined : { description: isEditor ? "It appears in Admin → Feedback." : "An editor will look at it." },
          ),
        onError: (e) => toast.error("Couldn't send feedback", { description: (e as Error).message }),
      },
    );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "grid grid-cols-1 shrink-0 place-items-center rounded-lg text-ink-3 transition outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-3 focus-visible:ring-ring data-popup-open:bg-surface-2 dark:hover:bg-white/[0.06]",
            small ? "size-8" : "size-9",
          )}
          aria-label="Give feedback on this connection"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-60 min-w-60 rounded-xl p-1.5">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-1.5 text-xs font-normal text-ink-3">Is this Scripture connection right?</DropdownMenuLabel>
            {OPTIONS.map((o) => {
              const Icon = o.icon;
              return (
                <DropdownMenuItem key={o.kind} className="gap-2.5 rounded-lg px-2 py-2" onClick={() => send(o.kind)}>
                  <Icon className="size-4 text-ink-3" aria-hidden /> {o.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2.5 rounded-lg px-2 py-2"
            onClick={() => {
              setNote("");
              setReportOpen(true);
            }}
          >
            <Flag className="size-4 text-ink-3" aria-hidden /> Report a problem…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send("report_content", note.trim() || undefined);
              setReportOpen(false);
            }}
          >
            <DialogHeader className="px-6 pt-6 pb-3">
              <DialogTitle className="font-display text-xl font-semibold">Report a problem</DialogTitle>
              <DialogDescription>Tell an editor what's wrong with this content. They'll review it in Admin.</DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-6">
              <label htmlFor="feedback-note" className="mb-1.5 block text-sm font-medium text-ink">What's the problem?</label>
              <textarea
                id="feedback-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="e.g. The speaker is quoting a different verse here."
                className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-ring focus:ring-3 focus:ring-ring/40 dark:bg-white/[0.04]"
              />
            </div>
            <DialogFooter className="mx-0 mb-0 rounded-none px-6 py-4">
              <Button type="button" variant="ghost" className="h-9 rounded-xl px-4" onClick={() => setReportOpen(false)}>Cancel</Button>
              <Button type="submit" className="h-9 rounded-xl px-4">Send report</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
