import type { RunReportView } from "../api";
import { listingName } from "../fixtures";
import type { WmEvent } from "../types";

const ACTORS = [
  "planner",
  "investigator.contact",
  "investigator.status",
  "investigator.specialty",
  "arbiter",
  "critic",
  "risk",
  "human",
] as const;

const HIDDEN_WHEN_EMPTY = new Set<(typeof ACTORS)[number]>([
  "investigator.status",
  "investigator.specialty",
]);

const ACTOR_LABEL: Record<(typeof ACTORS)[number], string> = {
  planner: "Planner",
  "investigator.contact": "Investigator (contact)",
  "investigator.status": "Investigator (status)",
  "investigator.specialty": "Investigator (specialty)",
  arbiter: "Arbiter",
  critic: "Critic",
  risk: "Risk",
  human: "Human",
};

const EVENT_LABEL: Record<WmEvent["type"], string> = {
  run_started: "Run started",
  task_created: "Task created",
  claim_added: "Claim added",
  conflict_found: "Conflict found",
  proposal_made: "Proposal made",
  critique: "Critique",
  retry_requested: "Retry requested",
  escalated: "Escalated",
  ruling_recorded: "Ruling recorded",
  applied: "Applied",
  run_finished: "Run finished",
};

type Props = {
  events: WmEvent[];
  report: RunReportView | null;
  settled: boolean;
  running: boolean;
};

export function LiveRun({ events, report, settled, running }: Props) {
  const applied = events.filter((event) => event.type === "applied").length;
  const escalated = events.filter((event) => event.type === "escalated").length;
  const retried = events.filter((event) => event.type === "retry_requested").length;
  const started = running || events.length > 0 || settled || report !== null;

  return (
    <div>
      {report?.status === "failed" ? (
        <div className="error-banner" role="alert">
          <p className="error-title">run failed: {report.error ?? "unknown error"}</p>
          <p className="error-hint">Check the agents service and the gateway, then start the batch again.</p>
        </div>
      ) : null}
      {!started ? (
        <p className="empty-state">Choose a batch and press Start. Events from each actor appear here.</p>
      ) : (
        <>
          {running && events.length === 0 ? (
            <p className="loading-state">Waiting for events… They show up under each actor as the agents report.</p>
          ) : null}
          <ul className="counts">
            <li>
              <span className="status status-applied">Applied</span>
              <span className="count-num">{applied}</span>
            </li>
            <li>
              <span className="status status-escalated">Escalated</span>
              <span className="count-num">{escalated}</span>
            </li>
            <li>
              <span className="count-label">Retried</span>
              <span className="count-num">{retried}</span>
            </li>
          </ul>
          {settled && report ? (
            <p className="report-counts">
              Report applied {report.applied}, escalated {report.escalated}, retried {report.retried}.
            </p>
          ) : null}
          {ACTORS.map((actor) => {
            const rows = events.filter((event) => event.actor === actor);
            if (rows.length === 0 && HIDDEN_WHEN_EMPTY.has(actor)) return null;
            return (
              <section key={actor} className="actor-group" aria-label={ACTOR_LABEL[actor]}>
                <div className="actor-head">
                  <h3>{ACTOR_LABEL[actor]}</h3>
                  <span className="count-pill">{rows.length}</span>
                </div>
                {rows.length === 0 ? (
                  <p className="empty-state">
                    {running ? "Waiting for this actor." : "No events from this actor."}
                  </p>
                ) : (
                  <ol className="timeline">
                    {rows.map((event) => (
                      <li key={event.eventId} className="timeline-item">
                        <span className={`event-type event-${eventTone(event.type)}`}>{EVENT_LABEL[event.type]}</span>
                        <span className="event-entity">{listingName(event.entityId)}</span>
                        {event.field ? <span className="event-field">{event.field}</span> : null}
                        <LlmChip payload={event.payload} />
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function eventTone(type: WmEvent["type"]): "applied" | "escalated" | "neutral" {
  if (type === "applied") return "applied";
  if (type === "escalated") return "escalated";
  return "neutral";
}

function LlmChip({ payload }: { payload: Record<string, unknown> }) {
  if (typeof payload.model !== "string" || typeof payload.latencyMs !== "number") {
    return null;
  }
  return (
    <span className="chips">
      <span className="chip">{payload.model}</span>
      <span className="chip">{payload.latencyMs} ms</span>
      {payload.replayed === true ? <span className="chip">replayed</span> : null}
    </span>
  );
}
