import { listingName } from "../fixtures";
import type { RunReport, WmEvent } from "../types";

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

type Props = {
  events: WmEvent[];
  report: RunReport | null;
  settled: boolean;
};

export function LiveRun({ events, report, settled }: Props) {
  const applied = events.filter((event) => event.type === "applied").length;
  const escalated = events.filter((event) => event.type === "escalated").length;
  const retried = events.filter((event) => event.type === "retry_requested").length;

  return (
    <div>
      <ul className="counts">
        <li>Applied {applied}</li>
        <li>Escalated {escalated}</li>
        <li>Retried {retried}</li>
      </ul>
      {settled && report ? (
        <p className="report-counts">
          Report applied {report.applied}, escalated {report.escalated}, retried {report.retried}.
        </p>
      ) : null}
      {ACTORS.map((actor) => {
        const rows = events.filter((event) => event.actor === actor);
        return (
          <section key={actor} className="actor-group" aria-label={ACTOR_LABEL[actor]}>
            <h3>
              {ACTOR_LABEL[actor]} ({rows.length})
            </h3>
            {rows.length === 0 ? (
              <p className="muted">Waiting</p>
            ) : (
              <ol className="timeline">
                {rows.map((event) => (
                  <li key={event.eventId}>
                    <span className="event-type">{event.type}</span>{" "}
                    <span>{listingName(event.entityId)}</span>
                    {event.field ? <span> · {event.field}</span> : null}
                    <LlmChip payload={event.payload} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}

function LlmChip({ payload }: { payload: Record<string, unknown> }) {
  if (typeof payload.model !== "string" || typeof payload.latencyMs !== "number") {
    return null;
  }
  return (
    <span className="chip">
      {payload.model} · {payload.latencyMs} ms
      {payload.replayed === true ? " · replayed" : ""}
    </span>
  );
}
