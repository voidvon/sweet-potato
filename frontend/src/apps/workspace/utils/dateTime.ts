
import { t } from '@shared/i18n';const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function parseDate(value?: string | Date | null) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfLocalWeek(date: Date) {
  const day = date.getDay();
  const mondayBasedOffset = day === 0 ? 6 : day - 1;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayBasedOffset);
}

function weekdayLabel(date: Date) {
  const labels = [t("星期日"), t("星期一"), t("星期二"), t("星期三"), t("星期四"), t("星期五"), t("星期六")];
  return labels[date.getDay()] || '';
}

export function formatTimeHM(value?: string | Date | null) {
  const date = parseDate(value);
  if (!date) {
    return '';
  }
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatRelativeCalendarDateTime(value?: string | Date | null, nowInput?: string | Date | null) {
  const date = parseDate(value);
  if (!date) {
    return '';
  }

  const now = parseDate(nowInput) || new Date();
  const dateDay = startOfLocalDay(date);
  const nowDay = startOfLocalDay(now);
  const dayDiff = Math.round((nowDay.getTime() - dateDay.getTime()) / DAY_MS);
  const timeText = formatTimeHM(date);

  if (dayDiff === 0) {
    return timeText;
  }
  if (dayDiff === 1) {
    return t("昨天 {{0}}", { "0": timeText });
  }
  if (dayDiff === 2) {
    return t("前天 {{0}}", { "0": timeText });
  }
  if (dateDay.getTime() >= startOfLocalWeek(now).getTime()) {
    return `${weekdayLabel(date)} ${timeText}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
