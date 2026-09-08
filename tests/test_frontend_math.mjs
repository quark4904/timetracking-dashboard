import assert from "node:assert/strict";

import {
  createReportBuckets,
  reportRangeFor,
  reportModeStep,
  reportSessionSegments,
} from "../app/static/modules/reporting.mjs";
import { defaultSessionTimes, localDateTimeToIso } from "../app/static/modules/date-time.mjs";

assert.equal(localDateTimeToIso("2026-02-01", "09:30"), "2026-02-01T00:30:00.000Z");
assert.equal(localDateTimeToIso("2026-02-30", "09:30"), null);

const original = "2026-08-01T01:00:45.123456+00:00";
assert.equal(localDateTimeToIso("2026-08-01", "10:00", original), original);
assert.equal(localDateTimeToIso("2026-08-01", "10:01", original), "2026-08-01T01:01:00.000Z");
assert.equal(localDateTimeToIso("2026-08-02", "10:00", original), "2026-08-02T01:00:00.000Z");
assert.equal(localDateTimeToIso("2026-02-30", "10:00", original), null);
assert.equal(reportModeStep("month")("2026-01-31", 1), "2026-02-01");
assert.equal(reportModeStep("month")("2026-03-31", -1), "2026-02-01");
assert.equal(reportModeStep("month")("2026-12-31", 1), "2027-01-01");
assert.equal(reportModeStep("year")("2024-02-29", 1), "2025-01-01");
assert.deepEqual(defaultSessionTimes("2026-09-08", new Date("2026-09-08T00:15:42+09:00")), {
  start: { date: "2026-09-07", time: "23:15" },
  end: { date: "2026-09-08", time: "00:15" },
});
assert.deepEqual(defaultSessionTimes("2026-09-07", new Date("2026-09-08T12:15:42+09:00")), {
  start: { date: "2026-09-07", time: "09:00" },
  end: { date: "2026-09-07", time: "10:00" },
});

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
