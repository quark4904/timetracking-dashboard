const KST_TIME_ZONE = "Asia/Seoul";

const kstPartsFormatter = new Intl.DateTimeFormat("en", {
  timeZone: KST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: KST_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function secondsBetween(start, end) {
  return Math.max(0, Math.floor((new Date(end || Date.now()) - new Date(start)) / 1000));
}

export function kstDateBoundary(date, hour = 0) {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`);
}

export function overlapSeconds(session, rangeStart, rangeEnd) {
  const start = Math.max(new Date(session.started_at).getTime(), rangeStart.getTime());
  const sessionEnd = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
  const end = Math.min(sessionEnd, rangeEnd.getTime());
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function formatDuration(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

export function formatLiveDuration(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function kstParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(kstPartsFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour),
    minute: parts.minute,
    second: parts.second,
  };
}

export function kstDateKey(value) {
  const parts = kstParts(value);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dateKey(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function dateFromKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(value, amount) {
  const date = dateFromKey(value);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

export function addMonths(value, amount) {
  const date = dateFromKey(value);
  date.setMonth(date.getMonth() + amount);
  return dateKey(date);
}

export function addYears(value, amount) {
  const date = dateFromKey(value);
  date.setFullYear(date.getFullYear() + amount);
  return dateKey(date);
}

export function startOfWeekKey(value) {
  const date = dateFromKey(value);
  date.setDate(date.getDate() - date.getDay());
  return dateKey(date);
}

export function localDateTimeParts(value) {
  if (!value) return "";
  const parts = kstParts(value);
  if (!parts) return "";
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(parts.hour).padStart(2, "0")}:${parts.minute}`,
  };
}

export function localDateTimeToIso(date, time) {
  if (!date || !time || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const value = new Date(`${date}T${time}:00+09:00`);
  if (Number.isNaN(value.getTime())) return null;
  const parts = localDateTimeParts(value);
  if (!parts || parts.date !== date || parts.time !== time) return null;
  return value.toISOString();
}
