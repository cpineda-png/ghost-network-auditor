import { useState } from "react";
import { listingName } from "../fixtures";
import { formatValue, isPossibleGhost, needsHuman, typedRulingValue } from "../format";
import { rulingSchema, type EvidenceCard, type Ruling, type Source } from "../types";

type Props = {
  runId: string | null;
  cards: EvidenceCard[];
  memoryIds: Record<string, string>;
  running?: boolean;
  onSubmit: (ruling: Ruling) => Promise<string>;
};

export function OutreachQueue({ runId, cards, memoryIds, running = false, onSubmit }: Props) {
  const queue = cards.filter((card) => card.status === "escalated");
  if (queue.length === 0) {
    if (running) {
      return (
        <p className="loading-state">
          Waiting for this run to finish. Escalations show up here if a field needs a ruling.
        </p>
      );
    }
    if (!runId) {
      return (
        <p className="empty-state">Choose a batch and press Start. Escalations that need a ruling show up here.</p>
      );
    }
    return <p className="empty-state">No escalations in this run.</p>;
  }
  return (
    <div className="card-list">
      {queue.map((card) => (
        <RulingForm
          key={`${card.listingId}:${card.field}`}
          formId="queue"
          runId={runId}
          card={card}
          memoryId={memoryIds[`${card.listingId}:${card.field}`] ?? null}
          onSubmit={onSubmit}
        />
      ))}
    </div>
  );
}

export function buildRuling(draft: {
  runId: string;
  listingId: string;
  field: EvidenceCard["field"];
  analyst: string;
  note: string;
  selected: { value: string | boolean | null; source: Source } | null;
  typed: string;
}): Ruling {
  const analyst = draft.analyst.trim() || "analyst";
  const note = draft.note.trim();
  const typed = draft.typed.trim();
  const shared = {
    runId: draft.runId,
    listingId: draft.listingId,
    field: draft.field,
    analyst,
    ...(note ? { note } : {}),
  };
  if (typed.length > 0) {
    return rulingSchema.parse({
      ...shared,
      value: typedRulingValue(draft.field, typed),
      source: "other",
    });
  }
  if (!draft.selected) {
    throw new Error("Pick a value or type one");
  }
  return rulingSchema.parse({
    ...shared,
    value: draft.selected.value,
    source: draft.selected.source,
  });
}

export function RulingForm({
  formId,
  runId,
  card,
  memoryId,
  showGhostLabel = true,
  showHeading = true,
  onSubmit,
}: {
  formId: string;
  runId: string;
  card: EvidenceCard;
  memoryId: string | null;
  showGhostLabel?: boolean;
  showHeading?: boolean;
  onSubmit: (ruling: Ruling) => Promise<string>;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [analyst, setAnalyst] = useState("analyst");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const human = needsHuman(card);
  const ghost = isPossibleGhost(card);
  const locked = pending || memoryId !== null;
  const group = `choice-${formId}-${card.listingId}-${card.field}`;
  const fieldSlug = `${formId}-${card.listingId}-${card.field}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const otherId = `other-${fieldSlug}`;

  return (
    <form
      className="outreach-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (locked) return;
        setError(null);
        try {
          const ruling = buildRuling({
            runId,
            listingId: card.listingId,
            field: card.field,
            analyst,
            note,
            selected: selected === null ? null : card.sources[selected],
            typed,
          });
          setPending(true);
          void onSubmit(ruling)
            .catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : "Ruling failed");
            })
            .finally(() => setPending(false));
        } catch (reason) {
          setPending(false);
          setError(reason instanceof Error ? reason.message : "Ruling failed");
        }
      }}
    >
      {showHeading ? (
        <h3>
          {listingName(card.listingId)} · {card.field}
        </h3>
      ) : null}
      {showGhostLabel && ghost ? <p className="needs-human">Possible ghost, needs analyst</p> : null}
      {!ghost && human.ghost ? <p className="needs-human">Needs a human: ghost listing</p> : null}
      {!ghost && human.notAccepting ? <p className="needs-human">Needs a human: not accepting change</p> : null}
      <fieldset className="choice-list" disabled={locked}>
        <legend>Pick a value</legend>
        {card.sources.map((source, index) => (
          <label key={`${source.source}-${index}`}>
            <input
              type="radio"
              name={group}
              checked={selected === index}
              onChange={() => setSelected(index)}
            />
            {source.source}: {formatValue(source.value)}
          </label>
        ))}
      </fieldset>
      <label htmlFor={otherId}>
        Other value
        <input
          id={otherId}
          value={typed}
          disabled={locked}
          aria-describedby={`${otherId}-hint`}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>
      <p id={`${otherId}-hint`} className="field-hint">
        Use this when none of the sources is right.
      </p>
      <label>
        Note
        <textarea rows={3} value={note} disabled={locked} onChange={(event) => setNote(event.target.value)} />
      </label>
      <label>
        Analyst
        <input value={analyst} disabled={locked} onChange={(event) => setAnalyst(event.target.value)} />
      </label>
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {memoryId ? <p className="memory-saved">Memory {memoryId}</p> : null}
      <button className="primary" type="submit" disabled={locked}>
        Submit ruling
      </button>
    </form>
  );
}
