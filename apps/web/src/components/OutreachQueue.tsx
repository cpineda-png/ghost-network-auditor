import { useState } from "react";
import { listingName } from "../fixtures";
import { formatValue, needsHuman, typedRulingValue } from "../format";
import { rulingSchema, type EvidenceCard, type Ruling, type Source } from "../types";

type Props = {
  runId: string | null;
  cards: EvidenceCard[];
  onSubmit: (ruling: Ruling) => Promise<void>;
};

export function OutreachQueue({ runId, cards, onSubmit }: Props) {
  const queue = cards.filter((card) => card.status === "escalated");
  if (!runId || queue.length === 0) {
    return <p className="muted">No escalations in this run.</p>;
  }
  return (
    <div className="card-list">
      {queue.map((card) => (
        <OutreachForm key={`${card.listingId}:${card.field}`} runId={runId} card={card} onSubmit={onSubmit} />
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

function OutreachForm({
  runId,
  card,
  onSubmit,
}: {
  runId: string;
  card: EvidenceCard;
  onSubmit: (ruling: Ruling) => Promise<void>;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [analyst, setAnalyst] = useState("analyst");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const human = needsHuman(card);
  const group = `choice-${card.listingId}-${card.field}`;

  return (
    <form
      className="outreach-form"
      onSubmit={(event) => {
        event.preventDefault();
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
          void onSubmit(ruling)
            .then(() => setSaved(true))
            .catch((reason: unknown) => {
              setSaved(false);
              setError(reason instanceof Error ? reason.message : "Ruling failed");
            });
        } catch (reason) {
          setSaved(false);
          setError(reason instanceof Error ? reason.message : "Ruling failed");
        }
      }}
    >
      <h3>
        {listingName(card.listingId)} · {card.field}
      </h3>
      {human.ghost ? <p className="needs-human">Needs a human: ghost listing</p> : null}
      {human.notAccepting ? <p className="needs-human">Needs a human: not accepting change</p> : null}
      <fieldset>
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
      <label>
        Other value
        <input value={typed} onChange={(event) => setTyped(event.target.value)} />
      </label>
      <label>
        Note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <label>
        Analyst
        <input value={analyst} onChange={(event) => setAnalyst(event.target.value)} />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {saved ? <p>Ruling recorded</p> : null}
      <button type="submit">Submit ruling</button>
    </form>
  );
}
