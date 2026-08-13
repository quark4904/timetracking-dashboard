import {
  addDays,
  addMonths,
  addYears,
  dateFromKey,
  dateKey,
  kstDateBoundary,
  kstDateKey,
  startOfWeekKey,
  overlapSeconds,
} from "./date-time.mjs";

const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const weekdayNames = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const shortWeekdayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const fullMonthDayFmt = new Intl.DateTimeFormat("en", { month: "long", day: "numeric" });
const fullMonthYearFmt = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" });
const shortMonthFmt = new Intl.DateTimeFormat("en", { month: "short" });
const shortMonthDayFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const shortMonthYearFmt = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });
const shortMonthDayYearFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

export function reportRangeFor(mode, value) {
  const date = dateFromKey(value);
  if (mode === "day") {
    const start = dateKey(date);
    return { start, end: addDays(start, 1), key: `${mode}:${start}` };
  }
  if (mode === "week") {
    const start = startOfWeekKey(value);
    return { start, end: addDays(start, 7), key: `${mode}:${start}` };
  }
  if (mode === "month") {
    const start = dateKey(new Date(date.getFullYear(), date.getMonth(), 1));
    return { start, end: addMonths(start, 1), key: `${mode}:${start}` };
  }
  const start = `${date.getFullYear()}-01-01`;
  return { start, end: `${date.getFullYear() + 1}-01-01`, key: `${mode}:${start}` };
}

export function reportModeStep(mode) {
  if (mode === "day") return (value, amount) => addDays(value, amount);
  if (mode === "week") return (value, amount) => addDays(value, amount * 7);
  if (mode === "month") return addMonths;
  return addYears;
}

export function reportPeriodLabel(mode, value, compact = false) {
  const date = dateFromKey(value);
  if (mode === "day") {
    return compact ? fullMonthDayFmt.format(date) : new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(date);
  }
  if (mode === "week") {
    const start = dateFromKey(startOfWeekKey(value));
    const end = dateFromKey(addDays(dateKey(start), 6));
    if (compact) return fullMonthDayFmt.format(start);
    return `${fullMonthDayFmt.format(start)}, ${start.getFullYear()} - ${fullMonthDayFmt.format(end)}, ${end.getFullYear()}`;
  }
  if (mode === "month") return fullMonthYearFmt.format(date);
  return String(date.getFullYear());
}

export function reportPeriodCompactLabel(mode, value) {
  const date = dateFromKey(value);
  if (mode === "day") return shortMonthDayYearFmt.format(date);
  if (mode === "week") {
    const start = dateFromKey(startOfWeekKey(value));
    const end = dateFromKey(addDays(dateKey(start), 6));
    if (start.getFullYear() === end.getFullYear()) {
      const year = `, ${start.getFullYear()}`;
      if (start.getMonth() === end.getMonth()) {
        return `${shortMonthFmt.format(start)} ${start.getDate()}–${end.getDate()}${year}`;
      }
      return `${shortMonthDayFmt.format(start)}–${shortMonthDayFmt.format(end)}${year}`;
    }
    return `${shortMonthDayFmt.format(start)}, ${start.getFullYear()}–${shortMonthDayFmt.format(end)}, ${end.getFullYear()}`;
  }
  if (mode === "month") return shortMonthYearFmt.format(date);
  return String(date.getFullYear());
}

export function currentReportDateForMode(mode, today = kstDateKey(new Date())) {
  if (mode === "week") return startOfWeekKey(today);
  if (mode === "month") {
    const date = dateFromKey(today);
    return dateKey(new Date(date.getFullYear(), date.getMonth(), 1));
  }
  if (mode === "year") {
    const date = dateFromKey(today);
    return `${date.getFullYear()}-01-01`;
  }
  return today;
}

export function createReportBuckets(mode, range) {
  if (mode === "day") {
    return Array.from({ length: 24 }, (_, index) => ({
      key: String(index).padStart(2, "0"),
      label: index % 3 === 0 ? String(index).padStart(2, "0") : "",
      start: kstDateBoundary(range.start, index),
      end: index === 23 ? kstDateBoundary(range.end) : kstDateBoundary(range.start, index + 1),
      total: 0,
      tasks: new Map(),
    }));
  }
  if (mode === "week") {
    return Array.from({ length: 7 }, (_, index) => {
      const key = addDays(range.start, index);
      const date = dateFromKey(key);
      return {
        key,
        label: `<span class="bar-weekday"><span class="bar-weekday-full">${weekdayNames[date.getDay()]}</span><span class="bar-weekday-short">${shortWeekdayNames[date.getDay()]}</span></span><span class="bar-date">${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}</span>`,
        start: kstDateBoundary(key),
        end: kstDateBoundary(addDays(key, 1)),
        total: 0,
        tasks: new Map(),
      };
    });
  }
  if (mode === "month") {
    const start = dateFromKey(range.start);
    const end = dateFromKey(range.end);
    const length = Math.round((end - start) / 86400000);
    return Array.from({ length }, (_, index) => {
      const key = addDays(range.start, index);
      const date = dateFromKey(key);
      return {
        key,
        label: String(date.getDate()),
        start: kstDateBoundary(key),
        end: kstDateBoundary(addDays(key, 1)),
        total: 0,
        tasks: new Map(),
      };
    });
  }
  const year = Number(range.start.slice(0, 4));
  return monthNames.map((label, index) => {
    const start = `${year}-${String(index + 1).padStart(2, "0")}-01`;
    const end = index === 11 ? `${year + 1}-01-01` : `${year}-${String(index + 2).padStart(2, "0")}-01`;
    return {
      key: String(index),
      label,
      start: kstDateBoundary(start),
      end: kstDateBoundary(end),
      total: 0,
      tasks: new Map(),
    };
  });
}

export function reportSessionSegments(sessions, range) {
  const rangeStart = kstDateBoundary(range.start);
  const rangeEnd = kstDateBoundary(range.end);
  const segments = [];
  sessions.forEach((session) => {
    const sessionStart = new Date(session.started_at);
    const sessionEnd = new Date(session.ended_at || Date.now());
    let cursor = new Date(Math.max(sessionStart.getTime(), rangeStart.getTime()));
    const clippedEnd = new Date(Math.min(sessionEnd.getTime(), rangeEnd.getTime()));
    while (cursor < clippedEnd) {
      const date = kstDateKey(cursor);
      const nextDay = kstDateBoundary(addDays(date, 1));
      const segmentEnd = new Date(Math.min(nextDay.getTime(), clippedEnd.getTime()));
      segments.push({
        ...session,
        segment_date: date,
        segment_started_at: cursor.toISOString(),
        segment_ended_at: segmentEnd.toISOString(),
        segment_seconds: overlapSeconds(session, cursor, segmentEnd),
      });
      cursor = segmentEnd;
    }
  });
  return segments.sort((a, b) => new Date(b.segment_started_at) - new Date(a.segment_started_at));
}
