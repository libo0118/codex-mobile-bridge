export class MobileEvent {
  id: string = '';
  sequence: number = 0;
  title: string = '';
  body: string = '';
  threadId: string = '';
  host: string = 'local';
  unread: boolean = true;
}

export class EventSnapshot {
  enabled: boolean = false;
  streamId: string = '';
  cursor: number = 0;
  events: MobileEvent[] = [];
}

/** A successful HTTP read is a snapshot, not proof that a notification was delivered. */
export class EventCursor {
  private stream: string = '';
  private cursor: number = 0;
  private initialized: boolean = false;

  reset(): void { this.stream = ''; this.cursor = 0; this.initialized = false; }
  after(): number { return this.cursor; }

  candidates(snapshot: EventSnapshot, visible: boolean): MobileEvent[] {
    if (!visible) { this.reset(); return []; }
    if (!snapshot || !Number.isSafeInteger(snapshot.cursor) || snapshot.cursor < 0 ||
      typeof snapshot.streamId !== 'string' || !Array.isArray(snapshot.events) || snapshot.events.length > 1000) throw new Error('通知响应无效');
    if (!snapshot.enabled || !this.initialized || this.stream !== snapshot.streamId || snapshot.cursor < this.cursor) {
      this.stream = snapshot.streamId; this.cursor = snapshot.cursor; this.initialized = !!snapshot.enabled;
      return [];
    }
    return snapshot.events.filter((event: MobileEvent) => typeof event.id === 'string' && event.id.length <= 256 &&
      Number.isSafeInteger(event.sequence) && event.sequence > this.cursor && event.sequence <= snapshot.cursor && event.unread !== false)
      .sort((left: MobileEvent, right: MobileEvent) => left.sequence - right.sequence);
  }

  delivered(sequence: number): void { this.cursor = Math.max(this.cursor, sequence); }
  complete(snapshot: EventSnapshot): void { this.cursor = Math.max(this.cursor, snapshot.cursor); }
}
