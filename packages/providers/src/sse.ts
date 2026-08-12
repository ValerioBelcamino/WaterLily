export class ServerSentEventDecoder {
  readonly #dataLines: string[] = [];
  #buffer = '';

  push(chunk: string): readonly string[] {
    this.#buffer += chunk;
    return this.#drain(false);
  }

  finish(): readonly string[] {
    const events = this.#drain(true);
    if (this.#dataLines.length > 0) {
      events.push(this.#flushData());
    }
    return events;
  }

  #consumeLine(line: string, events: string[]): void {
    if (line.length === 0) {
      if (this.#dataLines.length > 0) events.push(this.#flushData());
      return;
    }
    if (line.startsWith(':')) return;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== 'data') return;
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    this.#dataLines.push(value);
  }

  #drain(final: boolean): string[] {
    const events: string[] = [];
    while (this.#buffer.length > 0) {
      const carriage = this.#buffer.indexOf('\r');
      const newline = this.#buffer.indexOf('\n');
      const candidates = [carriage, newline].filter((index) => index >= 0);
      if (candidates.length === 0) break;
      const boundary = Math.min(...candidates);
      if (
        this.#buffer[boundary] === '\r' &&
        boundary === this.#buffer.length - 1 &&
        !final
      ) {
        break;
      }

      const line = this.#buffer.slice(0, boundary);
      const separatorLength =
        this.#buffer[boundary] === '\r' && this.#buffer[boundary + 1] === '\n'
          ? 2
          : 1;
      this.#buffer = this.#buffer.slice(boundary + separatorLength);
      this.#consumeLine(line, events);
    }

    if (final && this.#buffer.length > 0) {
      this.#consumeLine(this.#buffer, events);
      this.#buffer = '';
    }
    return events;
  }

  #flushData(): string {
    const data = this.#dataLines.join('\n');
    this.#dataLines.length = 0;
    return data;
  }
}
