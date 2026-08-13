import assert from "node:assert/strict";

import {
  createReportBuckets,
  reportRangeFor,
  reportSessionSegments,
} from "../app/static/modules/reporting.mjs";
import { localDateTimeToIso } from "../app/static/modules/date-time.mjs";

assert.equal(localDateTimeToIso("2026-02-01", "09:30"), "2026-02-01T00:30:00.000Z");
assert.equal(localDateTimeToIso("2026-02-30", "09:30"), null);

const range = { start: "2026-01-31", end: "2026-02-03" };
const segments = reportSessionSegments([
  {
    id: 1,
    task_id: 1,
    started_at: "2026-01-31T14:30:00.000Z",
    ended_at: "2026-02-01T16:30:00.000Z",
  },
], range);

assert.deepEqual(
  segments.map((segment) => [segment.segment_date, segment.segment_seconds]),
  [
    ["2026-02-02", 5400],
    ["2026-02-01", 86400],
    ["2026-01-31", 1800],
  ],
);

assert.deepEqual(reportRangeFor("week", "2026-01-31"), {
  start: "2026-01-25",
  end: "2026-02-01",
  key: "week:2026-01-25",
});
assert.equal(createReportBuckets("day", { start: "2026-02-01", end: "2026-02-02" }).length, 24);
assert.equal(createReportBuckets("month", { start: "2026-02-01", end: "2026-03-01" }).length, 28);
assert.equal(createReportBuckets("year", { start: "2026-01-01", end: "2027-01-01" }).length, 12);

console.log("frontend math tests passed");
