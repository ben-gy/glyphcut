/**
 * The event log drawer — a running account of what the tool actually did.
 *
 * For a privacy tool this is not decoration: it is the evidence. Every stage of the pipeline
 * reports here, and the log makes it visible that the work happened locally and that no upload
 * step exists.
 */

export type LogLevel = 'info' | 'good' | 'warn' | 'bad';

interface LogEntry {
  time: string;
  level: LogLevel;
  message: string;
}

const ICONS: Record<LogLevel, string> = {
  info: '·',
  good: '✓',
  warn: '!',
  bad: '×',
};

export class EventLog {
  private entries: LogEntry[] = [];
  private list: HTMLElement | null = null;
  private drawer: HTMLElement | null = null;
  private badge: HTMLElement | null = null;
  private unread = 0;

  mount(drawer: HTMLElement, list: HTMLElement, badge: HTMLElement): void {
    this.drawer = drawer;
    this.list = list;
    this.badge = badge;
    this.render();
  }

  log(message: string, level: LogLevel = 'info'): void {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(
      now.getSeconds(),
    ).padStart(2, '0')}`;
    this.entries.push({ time, level, message });
    // Keep the drawer bounded; a long session shouldn't grow without limit.
    if (this.entries.length > 400) this.entries.splice(0, this.entries.length - 400);
    if (!this.isOpen()) {
      this.unread++;
      this.updateBadge();
    }
    this.render();
  }

  isOpen(): boolean {
    return this.drawer?.classList.contains('is-open') ?? false;
  }

  open(): void {
    this.drawer?.classList.add('is-open');
    this.drawer?.setAttribute('aria-hidden', 'false');
    this.unread = 0;
    this.updateBadge();
    this.scrollToEnd();
  }

  close(): void {
    this.drawer?.classList.remove('is-open');
    this.drawer?.setAttribute('aria-hidden', 'true');
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  asText(): string {
    return this.entries.map((e) => `[${e.time}] ${ICONS[e.level]} ${e.message}`).join('\n');
  }

  private updateBadge(): void {
    if (!this.badge) return;
    this.badge.textContent = this.unread > 99 ? '99+' : String(this.unread);
    this.badge.hidden = this.unread === 0;
  }

  private scrollToEnd(): void {
    if (this.list) this.list.scrollTop = this.list.scrollHeight;
  }

  private render(): void {
    if (!this.list) return;
    const wasNearEnd =
      this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40 || this.list.scrollTop === 0;

    this.list.replaceChildren(
      ...this.entries.map((entry) => {
        const row = document.createElement('div');
        row.className = `log-row log-${entry.level}`;
        const time = document.createElement('span');
        time.className = 'log-time';
        time.textContent = entry.time;
        const icon = document.createElement('span');
        icon.className = 'log-icon';
        icon.textContent = ICONS[entry.level];
        const msg = document.createElement('span');
        msg.className = 'log-msg';
        msg.textContent = entry.message;
        row.append(time, icon, msg);
        return row;
      }),
    );

    if (wasNearEnd) this.scrollToEnd();
  }
}

export const eventLog = new EventLog();
