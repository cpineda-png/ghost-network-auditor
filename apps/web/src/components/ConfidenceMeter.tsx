import { THRESHOLDS } from "../types";

type Props = {
  confidence: number | null;
};

export function ConfidenceMeter({ confidence }: Props) {
  const retry = THRESHOLDS.retryFloor;
  const critic = THRESHOLDS.toCritic;
  const clamped = confidence === null ? null : Math.min(1, Math.max(0, confidence));
  const width = clamped === null ? 0 : clamped * 100;

  return (
    <div className="meter">
      {clamped === null ? (
        <div className="meter-track" aria-hidden="true">
          <div className="meter-fill-clip">
            <div className="meter-fill" style={{ width: "0%" }} />
          </div>
          <span className="meter-mark" style={{ left: `${retry * 100}%` }} />
          <span className="meter-mark" style={{ left: `${critic * 100}%` }} />
        </div>
      ) : (
        <div
          className="meter-track"
          role="meter"
          aria-label="Confidence"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={clamped}
          aria-valuetext={`Confidence ${clamped.toFixed(2)} of 1. Marks at ${retry.toFixed(2)} and ${critic.toFixed(2)}.`}
        >
          <div className="meter-fill-clip">
            <div className="meter-fill" style={{ width: `${width}%` }} />
          </div>
          <span className="meter-mark" style={{ left: `${retry * 100}%` }} />
          <span className="meter-mark" style={{ left: `${critic * 100}%` }} />
        </div>
      )}
      <div className="meter-scale" aria-hidden="true">
        <span className="meter-bound meter-bound-start">0</span>
        <span className="meter-tick" style={{ left: `${retry * 100}%` }}>
          {retry.toFixed(2)}
        </span>
        <span className="meter-tick" style={{ left: `${critic * 100}%` }}>
          {critic.toFixed(2)}
        </span>
        <span className="meter-bound meter-bound-end">1</span>
      </div>
    </div>
  );
}
