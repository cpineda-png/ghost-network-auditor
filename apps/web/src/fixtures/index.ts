import coldCards from "./cold/cards.json";
import coldEvents from "./cold/events.json";
import coldReport from "./cold/report.json";
import diffCsv from "./diff.csv?raw";
import names from "./listingNames.json";
import receipts from "./receipts.json";
import trust from "./trust.json";
import warmCards from "./warm/cards.json";
import warmEvents from "./warm/events.json";
import warmReport from "./warm/report.json";

export const COLD_RUN_ID = "run-cold";
export const WARM_RUN_ID = "run-warm";

export const fixtureRuns = {
  [COLD_RUN_ID]: { events: coldEvents, cards: coldCards, report: coldReport },
  [WARM_RUN_ID]: { events: warmEvents, cards: warmCards, report: warmReport },
};

export const fixtureReceipts = receipts;
export const fixtureTrust = trust;
export const fixtureDiffCsv = diffCsv;
export const listingNames = names as Record<string, string>;

export function fixtureRun(runId: string) {
  if (runId === COLD_RUN_ID || runId === WARM_RUN_ID) {
    return fixtureRuns[runId];
  }
  return undefined;
}

export function listingName(listingId: string): string {
  return listingNames[listingId] ?? listingId;
}
