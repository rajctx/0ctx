export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function compactPath(value?: string | null) {
  if (!value) {
    return 'No repository bound';
  }
  return value.length > 56 ? `${value.slice(0, 28)}...${value.slice(-22)}` : value;
}

export function normalizePath(value?: string | null) {
  return String(value || '').replace(/\\/g, '/');
}

export function workstreamKey(branch?: string | null, worktreePath?: string | null) {
  return `${String(branch || '')}::${String(worktreePath || '')}`;
}

function toDate(value?: string | number | null) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const candidate = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

export function formatRelativeLabel(value?: string | number | null) {
  const date = toDate(value);
  if (!date) {
    return 'No timestamp';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function formatRelativeAge(value?: string | number | null) {
  const date = toDate(value);
  if (!date) {
    return 'No timestamp';
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 48) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatClockTime(value?: string | number | null) {
  const date = toDate(value);
  if (!date) {
    return '--:--:--';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

export function formatShortSha(value?: string | null) {
  if (!value) {
    return 'Unavailable';
  }

  const normalized = String(value).replace(/^#/, '');
  return `#${normalized.slice(0, 8)}`;
}

export function pickText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const candidate = String(value || '').trim();
    if (candidate) {
      return candidate;
    }
  }
  return 'No detail available.';
}
