import { listingName } from "../fixtures";
import { formatValue, isPossibleGhost } from "../format";
import { THRESHOLDS, type EvidenceCard, type Ruling } from "../types";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { RulingForm } from "./OutreachQueue";

type Props = {
  cards: EvidenceCard[];
  runId: string | null;
  loading: boolean;
  error: string | null;
  settled: boolean;
  running?: boolean;
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
  running = false,
  memoryIds,
  onOpenReceipt,
  onSubmitRuling,
}: Props) {
  if (loading) return <p className="loading-state">Loading evidence… Cards appear when the request finishes.</p>;
  if (error) {
    return (
      <div className="error-banner" role="alert">
        <p className="error-title">{error}</p>
        <p className="error-hint">Evidence did not load. Check the agents service, then start the batch again.</p>
      </div>
    );
  }
  if (cards.length === 0) {
    if (running || (runId !== null && !settled)) {
      return (
        <p className="loading-state">Waiting for this run to finish. Evidence cards load next.</p>
      );
    }
    if (settled) return <p className="empty-state">No evidence cards for this run.</p>;
    return (
      <p className="empty-state">Choose a batch and press Start. Evidence cards load when the run finishes.</p>
    );
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
      <header className="card-head">
        <h3>
          {listingName(card.listingId)} · {card.field}
        </h3>
        <span className={`status status-${statusKind(shownStatus)}`} role="status">
          {statusLabel(shownStatus)}
        </span>
      </header>
      {ghost ? <p className="needs-human">Possible ghost, needs analyst</p> : null}
      <dl className="meta">
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
          <dd>
            <span className="confidence-value">{card.confidence === null ? "none" : card.confidence.toFixed(2)}</span>
            <ConfidenceMeter confidence={card.confidence} />
          </dd>
        </div>
      </dl>
      <p className="threshold-note">{thresholdText(card.confidence)}</p>
      <div className="source-block">
        <div className="source-head" aria-hidden="true">
          <span>Source</span>
          <span>Value</span>
          <span>Receipts</span>
        </div>
        <ul className="source-table">
          {card.sources.map((source) => {
            const winning = card.winner?.source === source.source;
            return (
              <li key={source.source} className={winning ? "source-row source-winner" : "source-row"}>
                <span className="source-cell">
                  <span className="source-key">Source</span>
                  <span className="source-val">
                    {source.source}
                    {winning ? <span className="winner-tag">Winning source</span> : null}
                  </span>
                </span>
                <span className="source-cell">
                  <span className="source-key">Value</span>
                  <span className="source-val">{formatValue(source.value)}</span>
                </span>
                <span className="source-cell">
                  <span className="source-key">Receipts</span>
                  <span className="source-val">
                    {source.receiptIds.map((receiptId) => (
                      <button
                        key={receiptId}
                        type="button"
                        className="receipt-id"
                        onClick={() => onOpenReceipt(receiptId)}
                      >
                        {receiptId}
                      </button>
                    ))}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="winner-line">
        Winner: {card.winner ? `${formatValue(card.winner.value)} (${card.winner.source})` : "none"}
      </p>
      <p className="rationale">{card.rationale}</p>
      {card.critique ? (
        <div className="critique">
          <p className="critique-line">
            Critic <span className={`verdict verdict-${card.critique.verdict}`}>{verdictLabel(card.critique.verdict)}</span>
          </p>
          <ul className="reason-list">
            {card.critique.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted">No critic verdict</p>
      )}
      <p className="memory-line">Memory: {card.memoryIds.length > 0 ? card.memoryIds.join(", ") : "none"}</p>
      {ghost && runId && onSubmitRuling ? (
        <RulingForm
          formId="card"
          runId={runId}
          card={card}
          memoryId={memoryId}
          showGhostLabel={false}
          showHeading={false}
          onSubmit={onSubmitRuling}
        />
      ) : null}
    </article>
  );
}

function statusKind(status: string): string {
  if (status === "applied" || status === "escalated" || status === "unchanged") return status;
  return "neutral";
}

function statusLabel(status: string): string {
  if (status.length === 0) return status;
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function verdictLabel(verdict: string): string {
  if (verdict.length === 0) return verdict;
  return verdict.charAt(0).toUpperCase() + verdict.slice(1);
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
