import { listingName } from "../fixtures";
import { formatValue, isPossibleGhost } from "../format";
import { THRESHOLDS, type EvidenceCard, type Ruling } from "../types";
import { RulingForm } from "./OutreachQueue";

type Props = {
  cards: EvidenceCard[];
  runId: string | null;
  loading: boolean;
  error: string | null;
  settled: boolean;
  memoryIds: Record<string, string>;
  onOpenReceipt: (receiptId: string) => void;
  onSubmitRuling: (ruling: Ruling) => Promise<string>;
};

export function EvidenceCards({
  cards,
  runId,
  loading,
  error,
  settled,
  memoryIds,
  onOpenReceipt,
  onSubmitRuling,
}: Props) {
  if (loading) return <p>Loading evidence…</p>;
  if (error) return <p role="alert">{error}</p>;
  if (cards.length === 0) {
    return <p className="muted">{settled ? "No evidence cards." : "Start a run to load evidence cards."}</p>;
  }
  return (
    <div className="card-list">
      {cards.map((card) => (
        <EvidenceCardView
          key={`${card.listingId}:${card.field}`}
          card={card}
          runId={runId}
          memoryId={memoryIds[`${card.listingId}:${card.field}`] ?? null}
          onOpenReceipt={onOpenReceipt}
          onSubmitRuling={onSubmitRuling}
        />
      ))}
    </div>
  );
}

export function EvidenceCardView({
  card,
  runId = null,
  memoryId = null,
  onOpenReceipt,
  onSubmitRuling,
}: {
  card: EvidenceCard;
  runId?: string | null;
  memoryId?: string | null;
  onOpenReceipt: (receiptId: string) => void;
  onSubmitRuling?: (ruling: Ruling) => Promise<string>;
}) {
  const shownStatus =
    card.confidence !== null && card.confidence < THRESHOLDS.retryFloor ? "escalated" : card.status;
  const directory = card.sources.find((source) => source.source === "directory");
  const ghost = isPossibleGhost(card);

  return (
    <article className="evidence-card">
      <h3>
        {listingName(card.listingId)} · {card.field}
      </h3>
      {ghost ? <p className="needs-human">Possible ghost, needs analyst</p> : null}
      <dl>
        <div>
          <dt>Field</dt>
          <dd>{card.field}</dd>
        </div>
        <div>
          <dt>Old value</dt>
          <dd>{directory ? formatValue(directory.value) : "none"}</dd>
        </div>
        <div>
          <dt>New value</dt>
          <dd>{card.winner ? formatValue(card.winner.value) : "none"}</dd>
        </div>
        <div>
          <dt>Winning source</dt>
          <dd>{card.winner ? card.winner.source : "none"}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{card.confidence === null ? "none" : card.confidence.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd role="status">{shownStatus}</dd>
        </div>
      </dl>
      <p>{thresholdText(card.confidence)}</p>
      <ul>
        {card.sources.map((source) => (
          <li key={source.source}>
            <span>
              {source.source}: {formatValue(source.value)}
            </span>
            {source.receiptIds.map((receiptId) => (
              <button key={receiptId} type="button" onClick={() => onOpenReceipt(receiptId)}>
                {receiptId}
              </button>
            ))}
          </li>
        ))}
      </ul>
      <p>
        Winner:{" "}
        {card.winner ? `${formatValue(card.winner.value)} (${card.winner.source})` : "none"}
      </p>
      <p>{card.rationale}</p>
      {card.critique ? (
        <div>
          <p>Critic {card.critique.verdict}</p>
          <ul>
            {card.critique.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p>No critic verdict</p>
      )}
      <p>Memory: {card.memoryIds.length > 0 ? card.memoryIds.join(", ") : "none"}</p>
      {ghost && runId && onSubmitRuling ? (
        <RulingForm
          formId="card"
          runId={runId}
          card={card}
          memoryId={memoryId}
          showGhostLabel={false}
          onSubmit={onSubmitRuling}
        />
      ) : null}
    </article>
  );
}

function thresholdText(confidence: number | null): string {
  if (confidence === null) return "No confidence score.";
  const score = confidence.toFixed(2);
  if (confidence >= THRESHOLDS.toCritic) {
    return `Confidence ${score} meets the critic threshold (${THRESHOLDS.toCritic.toFixed(2)}).`;
  }
  if (confidence >= THRESHOLDS.retryFloor) {
    return `Confidence ${score} meets the retry floor (${THRESHOLDS.retryFloor.toFixed(2)}) and is short of the critic threshold (${THRESHOLDS.toCritic.toFixed(2)}).`;
  }
  return `Confidence ${score} is under the retry floor (${THRESHOLDS.retryFloor.toFixed(2)}).`;
}
