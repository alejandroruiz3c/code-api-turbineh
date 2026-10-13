"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { keyAction } from "@/kanban/keyboard";

/**
 * Accessible kanban board (component ui.kanban.turbineh): status columns, cards moved by drag and drop or with the
 * keyboard (Space to pick up, arrows to choose a column, Space/Enter to drop, Escape to cancel), every move announced
 * in a live region. `move` is a server action that re-checks the move; a refused move puts the card back.
 */
export interface KanbanColumn {
  key: string;
  label: string;
}

export interface KanbanCard {
  id: string;
  title: string;
  column: string;
  href: string;
  /** Columns this person may move the card to (from the workflow's transitions and their role). */
  allowed: string[];
  badges: { label: string; tone: "warning" | "danger" | "muted" }[];
}

export type MoveResult = { ok: boolean; message: string };

const TONE = {
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  muted: "bg-subtle text-muted",
} as const;

export function KanbanBoard({
  columns,
  cards: initial,
  dragAndDrop,
  move,
}: {
  columns: KanbanColumn[];
  cards: KanbanCard[];
  dragAndDrop: boolean;
  move: (id: string, to: string) => Promise<MoveResult>;
}) {
  const router = useRouter();
  const help = useId();
  const [cards, setCards] = useState(initial);
  // Fresh server data (after a move or a refresh) replaces the local copy; the announcement stays.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setCards(initial);
  }
  const [picked, setPicked] = useState<{ id: string; home: string; target: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [, startTransition] = useTransition();
  const label = (key: string) => columns.find((c) => c.key === key)?.label ?? key;
  const keys = columns.map((c) => c.key);

  function doMove(id: string, to: string) {
    const card = cards.find((c) => c.id === id);
    if (!card || card.column === to) return;
    const from = card.column;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, column: to } : c)));
    startTransition(async () => {
      const r = await move(id, to);
      if (r.ok) {
        setAnnouncement(`Moved "${card.title}" to ${label(to)}.`);
        router.refresh();
      } else {
        setCards((cs) => cs.map((c) => (c.id === id ? { ...c, column: from } : c)));
        setAnnouncement(`"${card.title}" stays in ${label(from)}: ${r.message}`);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p id={help} className="sr-only">
        Press Space to pick up a card, the left and right arrow keys to choose a column, Space or
        Enter to drop it there and Escape to cancel.
      </p>
      <p
        role="status"
        aria-live="polite"
        className="min-h-5 text-sm text-muted"
        data-testid="kanban-status"
      >
        {announcement}
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-flow-col md:auto-cols-fr" data-testid="kanban">
        {columns.map((col) => {
          const inCol = cards.filter((c) => c.column === col.key);
          const target = picked?.target === col.key || dragging === col.key;
          const dropOk = dragging
            ? (cards.find((c) => c.id === dragging)?.allowed.includes(col.key) ?? false)
            : false;
          return (
            <section
              key={col.key}
              aria-label={col.label}
              data-testid={`state-${col.key}`}
              onDragOver={(e) => {
                if (!dragAndDrop) return;
                e.preventDefault();
              }}
              onDrop={(e) => {
                if (!dragAndDrop) return;
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                setDragging(null);
                if (id) doMove(id, col.key);
              }}
              className={`rounded-lg border bg-panel p-4 ${target ? "border-accent" : "border-line"} ${dropOk ? "bg-subtle" : ""}`}
            >
              <h2 className="mb-3 font-semibold">
                {col.label} <span className="text-muted">({inCol.length})</span>
              </h2>
              <ul className="flex min-h-12 flex-col gap-2 text-sm">
                {inCol.map((card) => (
                  <li
                    key={card.id}
                    data-testid="card"
                    data-id={card.id}
                    draggable={dragAndDrop}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", card.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(card.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={`flex items-start justify-between gap-2 rounded-md border bg-surface px-3 py-2 ${picked?.id === card.id ? "border-accent" : "border-line"}`}
                  >
                    <div>
                      <Link href={card.href} className="font-medium">
                        {card.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {card.badges.map((b) => (
                          <span key={b.label} className={`rounded px-2 text-xs ${TONE[b.tone]}`}>
                            {b.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    {dragAndDrop ? (
                      <button
                        type="button"
                        aria-label={`Move ${card.title}`}
                        aria-describedby={help}
                        aria-pressed={picked?.id === card.id}
                        className="rounded px-1 text-muted hover:bg-subtle"
                        onKeyDown={(e) => {
                          const state = picked?.id === card.id ? picked : null;
                          const a = keyAction(
                            e.key,
                            {
                              picked: !!state,
                              home: card.column,
                              target: state?.target ?? card.column,
                            },
                            keys,
                            card.allowed,
                          );
                          if (!a) return;
                          e.preventDefault();
                          if (a.type === "pick") {
                            setPicked({ id: card.id, home: card.column, target: card.column });
                            setAnnouncement(`Picked up "${card.title}" in ${label(card.column)}.`);
                          } else if (a.type === "target") {
                            setPicked({ id: card.id, home: card.column, target: a.column });
                            setAnnouncement(`Over ${label(a.column)}.`);
                          } else if (a.type === "cancel") {
                            setPicked(null);
                            setAnnouncement(`"${card.title}" stays in ${label(card.column)}.`);
                          } else {
                            setPicked(null);
                            doMove(card.id, a.column);
                          }
                        }}
                      >
                        ⠿
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
