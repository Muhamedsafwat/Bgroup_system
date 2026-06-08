"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, AtSign, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * In-opp discussion thread.
 *
 * Reps and managers leave comments on the opp. Typing `@` opens a
 * dropdown of CRM users; selecting one inserts a `@<id>` token into
 * the body AND adds the id to a side-list. On submit we send both:
 *   - body: raw text with @<id> tokens (durable across renames)
 *   - mentionIds: the id list the server uses for notification fan-out
 *
 * On render we replace every `@<id>` with the matching mention's
 * fullName as a styled chip. Unknown ids (deleted users, edits) fall
 * back to the literal text so the comment isn't lost.
 */

type Mention = {
  id: string;
  fullName: string;
  avatarUrl: string | null;
};

type Author = Mention & { role: string };

type Comment = {
  id: string;
  body: string;
  author: Author;
  mentions: Mention[];
  createdAt: string;
  editedAt: string | null;
  isOwn: boolean;
};

type MentionablePick = {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  role: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h ago`;
  if (diffMin < 60 * 24 * 7) return `${Math.floor(diffMin / (60 * 24))}d ago`;
  return d.toLocaleDateString();
}

/**
 * Replace `@<id>` tokens with chips resolved against `mentions`.
 * Unknown ids fall through as raw text so old data still renders.
 */
function renderBody(body: string, mentions: Mention[]) {
  const byId = new Map(mentions.map((m) => [m.id, m]));
  const parts: (string | { mention: Mention })[] = [];
  // Broad enough to cover Prisma's `@default(cuid())` (lowercase
  // base36, 25 chars), `cuid(2)` (mixed case, 24 chars), and uuid
  // (hex with dashes). Anchoring at `@` and requiring an 8+ char
  // identifier keeps it from matching arbitrary email addresses.
  const regex = /@([A-Za-z0-9_-]{8,})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    if (match.index > lastIndex) parts.push(body.slice(lastIndex, match.index));
    const m = byId.get(match[1]);
    if (m) parts.push({ mention: m });
    else parts.push(match[0]);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex));
  return parts.map((p, i) =>
    typeof p === "string" ? (
      <span key={i}>{p}</span>
    ) : (
      <span
        key={i}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium align-baseline"
      >
        <AtSign className="h-3 w-3" />
        {p.mention.fullName}
      </span>
    ),
  );
}

export function OpportunityComments({ oppId }: { oppId: string }) {
  const { data: session } = useSession();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  // Mention picker state.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<MentionablePick[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerCursorIdx, setPickerCursorIdx] = useState(0);
  // True only after the user has explicitly used arrow keys to
  // navigate the dropdown — guards against an unintended Enter
  // press on the first cursor inserting whoever the fuzzy-match
  // happened to put first. Reset every time the picker re-opens.
  const [pickerHasMoved, setPickerHasMoved] = useState(false);
  // Range in the textarea where the current `@query` lives — used
  // to splice the @<id> token back in once a pick is made.
  const pickerRange = useRef<{ start: number; end: number } | null>(null);

  // Initial load + 30s poll. The bell SSE also invalidates when a
  // mention lands, but this thread doesn't subscribe to the bus
  // directly — a polling backstop keeps reading reps in sync with
  // each other without a per-thread channel.
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    async function load(firstLoad: boolean) {
      try {
        const res = await fetch(`/api/crm/opportunities/${oppId}/comments`);
        if (!res.ok) throw new Error("Failed to load comments");
        const data = await res.json();
        if (mounted) {
          setComments(data.comments ?? []);
          setLoadError(null);
        }
      } catch (e) {
        // Distinguish from the "no comments yet" empty state — show
        // an actual error tile so the user knows the thread didn't
        // load. Background poll failures don't clobber an already-
        // loaded list, but the next first-load surface re-shows the
        // error so the user can manually retry.
        if (mounted && firstLoad) {
          setLoadError(e instanceof Error ? e.message : "Couldn't load comments");
        }
        console.warn("[OpportunityComments] load failed:", e);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load(true);
    const interval = setInterval(() => load(false), 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [oppId]);

  // Scroll to bottom on new content.
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [comments.length]);

  // Pickup query suggestions while the picker is open.
  useEffect(() => {
    if (!pickerOpen) return;
    let cancel = false;
    setPickerLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/crm/users/mentionable?q=${encodeURIComponent(pickerQuery)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancel) {
          setPickerResults(data.users ?? []);
          setPickerCursorIdx(0);
        }
      } finally {
        if (!cancel) setPickerLoading(false);
      }
    }, 150);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [pickerOpen, pickerQuery]);

  function onDraftChange(value: string) {
    setDraft(value);
    // Detect an in-progress `@query` at the caret. The picker opens
    // when the caret is immediately preceded by `@<chars>` with no
    // intervening whitespace. Backspacing past the `@` closes it.
    const el = textareaRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const slice = value.slice(0, caret);
    const m = slice.match(/(?:^|\s)@(\S*)$/);
    if (m) {
      const queryStart = caret - m[1].length;
      pickerRange.current = { start: queryStart - 1, end: caret }; // include the `@`
      setPickerQuery(m[1]);
      // Re-opening the picker clears the "explicit move" flag, so
      // Enter on a fresh dropdown doesn't auto-pick the first
      // fuzzy match. Pressing ArrowDown / ArrowUp sets it.
      if (!pickerOpen) setPickerHasMoved(false);
      setPickerOpen(true);
    } else {
      setPickerOpen(false);
      setPickerHasMoved(false);
      pickerRange.current = null;
    }
  }

  function pickMention(user: MentionablePick) {
    const el = textareaRef.current;
    if (!el || !pickerRange.current) {
      setPickerOpen(false);
      return;
    }
    const { start, end } = pickerRange.current;
    // Insert the durable token + a trailing space so the next char
    // typed isn't glued to the chip when the parser sees it next.
    const next = draft.slice(0, start) + `@${user.id} ` + draft.slice(end);
    setDraft(next);
    setMentionIds((prev) => (prev.includes(user.id) ? prev : [...prev, user.id]));
    setPickerOpen(false);
    pickerRange.current = null;
    // Restore caret to the position right after the inserted token.
    const newCaret = start + user.id.length + 2; // +2 for `@` and space
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newCaret, newCaret);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (pickerOpen && pickerResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPickerCursorIdx((i) => (i + 1) % pickerResults.length);
        setPickerHasMoved(true);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPickerCursorIdx(
          (i) => (i - 1 + pickerResults.length) % pickerResults.length,
        );
        setPickerHasMoved(true);
        return;
      }
      if (e.key === "Tab") {
        // Tab always picks the current cursor — standard
        // autocomplete contract; users press Tab when they mean to
        // commit.
        e.preventDefault();
        pickMention(pickerResults[pickerCursorIdx]);
        return;
      }
      if (e.key === "Enter") {
        // Enter only picks when the user has explicitly moved the
        // cursor with arrows. Otherwise, Enter falls through to its
        // default behaviour (newline in the textarea) — protects
        // against a stray Enter accidentally tagging the first
        // fuzzy match.
        if (pickerHasMoved) {
          e.preventDefault();
          pickMention(pickerResults[pickerCursorIdx]);
        } else {
          // Treat as a regular newline — also close the picker so
          // the dropdown doesn't shadow the rest of the line.
          setPickerOpen(false);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPickerOpen(false);
        return;
      }
    }
    // Ctrl/Cmd+Enter submits.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  async function submit() {
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    // Only forward mention ids that still appear in the body —
    // a user who typed @x and then deleted it shouldn't fan out.
    const trimmedBody = draft.trim();
    const stillReferenced = mentionIds.filter((id) => draft.includes(`@${id}`));
    // Optimistic insert: show the comment in the thread immediately
    // using a placeholder id and the live session's author info.
    // Reconciled by replacing the placeholder when the server
    // returns; rolled back on failure. The user no longer waits on
    // network roundtrip to see their post appear.
    const tempId = `optimistic-${Date.now()}`;
    const optimistic: Comment = {
      id: tempId,
      body: trimmedBody,
      author: {
        id: session?.user?.crmProfileId ?? "self",
        fullName: session?.user?.name ?? "You",
        avatarUrl: null,
        role: (session?.user?.crmRole as string | undefined) ?? "REP",
      },
      // Mentions are resolved server-side; we render the raw @<id>
      // tokens in the placeholder, then the real chips appear when
      // the server confirms.
      mentions: [],
      createdAt: new Date().toISOString(),
      editedAt: null,
      isOwn: true,
    };
    setComments((prev) => [...prev, optimistic]);
    setDraft("");
    setMentionIds([]);
    try {
      let res: Response;
      try {
        res = await fetch(`/api/crm/opportunities/${oppId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: trimmedBody, mentionIds: stillReferenced }),
        });
      } catch {
        // Network failure (offline, DNS, aborted) — fetch throws here,
        // not at res.ok. Roll back the optimistic insert and restore
        // the draft so the user doesn't lose what they typed.
        toast.error("Couldn't reach the server. Your draft is preserved.");
        setComments((prev) => prev.filter((c) => c.id !== tempId));
        setDraft(trimmedBody);
        setMentionIds(stillReferenced);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't post comment");
        setComments((prev) => prev.filter((c) => c.id !== tempId));
        setDraft(trimmedBody);
        setMentionIds(stillReferenced);
        return;
      }
      // Replace the placeholder with the canonical server row.
      setComments((prev) => prev.map((c) => (c.id === tempId ? data.comment : c)));
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteComment(c: Comment) {
    if (!confirm("Delete this comment?")) return;
    const prev = comments;
    setComments((cur) => cur.filter((x) => x.id !== c.id));
    try {
      const res = await fetch(
        `/api/crm/opportunities/${oppId}/comments/${c.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Couldn't delete");
        setComments(prev);
      }
    } catch {
      // Network failure — silent rollback would leave the user wondering
      // why the comment reappeared. Toast + restore the prior list.
      toast.error("Couldn't reach the server. The comment is still here.");
      setComments(prev);
    }
  }

  const dropdownItems = useMemo(() => pickerResults.slice(0, 8), [pickerResults]);

  return (
    <div className="flex flex-col h-full max-h-[600px]">
      <div className="flex-1 overflow-y-auto px-1 py-2 space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Loading…
          </div>
        ) : loadError && comments.length === 0 ? (
          <div className="text-sm text-destructive text-center py-8">
            Couldn&apos;t load comments. Refresh the page to retry.
          </div>
        ) : comments.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No comments yet. Start the discussion below — type{" "}
            <span className="font-mono">@</span> to mention a teammate.
          </div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <Avatar className="h-8 w-8 mt-0.5 shrink-0">
                {c.author.avatarUrl && (
                  <AvatarImage src={c.author.avatarUrl} alt={c.author.fullName} />
                )}
                <AvatarFallback className="text-xs">
                  {initials(c.author.fullName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{c.author.fullName}</span>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {c.author.role}
                  </span>
                  <span className="text-xs text-muted-foreground ms-auto">
                    {fmtTime(c.createdAt)}
                    {c.editedAt && " · edited"}
                  </span>
                  {c.isOwn && (
                    <button
                      onClick={() => deleteComment(c)}
                      className="text-muted-foreground hover:text-destructive p-0.5"
                      aria-label="Delete comment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="text-sm leading-relaxed whitespace-pre-wrap break-words mt-0.5">
                  {renderBody(c.body, c.mentions)}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={scrollEndRef} />
      </div>
      <div className="border-t pt-3 mt-2 relative">
        {pickerOpen && dropdownItems.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-72 bg-popover text-popover-foreground border rounded-md shadow-lg overflow-hidden z-10">
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-b">
              {pickerLoading ? "Searching…" : `Mention ${dropdownItems.length === 1 ? "1 person" : `${dropdownItems.length} people`}`}
            </div>
            <ul className="max-h-56 overflow-y-auto">
              {dropdownItems.map((u, i) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent transition-colors",
                      i === pickerCursorIdx && "bg-accent",
                    )}
                    onClick={() => pickMention(u)}
                  >
                    <Avatar className="h-6 w-6">
                      {u.avatarUrl && <AvatarImage src={u.avatarUrl} alt={u.fullName} />}
                      <AvatarFallback className="text-[10px]">
                        {initials(u.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.fullName}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{u.email}</div>
                    </div>
                    <span className="text-[10px] uppercase text-muted-foreground">{u.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a comment… type @ to mention"
            rows={2}
            className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button
            onClick={submit}
            disabled={!draft.trim() || submitting}
            size="sm"
            className="shrink-0"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Send className="h-4 w-4 me-1" />
                Send
              </>
            )}
          </Button>
        </div>
        <div className="text-[11px] text-muted-foreground mt-1">
          Tip: type <span className="font-mono">@</span> to mention a teammate ·
          Ctrl+Enter to send
        </div>
      </div>
    </div>
  );
}
