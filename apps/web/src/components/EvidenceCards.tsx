import { listingName } from "../fixtures";
import { formatValue } from "../format";
import { THRESHOLDS, type EvidenceCard } from "../types";

type Props = {
  cards: EvidenceCard[];
  onOpenReceipt: (receiptId: string) => void;
};

export function EvidenceCards({ cards, onOpenReceipt }: Props) {
  if (cards.length === 0) {
    return <p className="muted">Start a run to load evidence cards.</p>;
  }
  return (
    <div className="card-list">
      {cards.map((card) => (
        <EvidenceCardView key={`${card.listingId}:${card.field}`} card={card} onOpenReceipt={onOpenReceipt} />
      ))}
    </div>
  );
}

export function EvidenceCardView({
  card,
  onOpenReceipt,
}: {
  card: EvidenceCard;
  onOpenReceipt: (receiptId: string) => void;
}) {
  const shownStatus =
    card.confidence !== null && card.confidence < THRESHOLDS.retryFloor ? "escalated" : card.status;

  return (
    <article className="evidence-card">
      <h3>
        {listingName(card.listingId)} · {card.field}
      </h3>
      <p role="status">{shownStatus}</p>
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
