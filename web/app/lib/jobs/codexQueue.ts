type CodexTask<T> = () => Promise<T>;

interface QueueItem<T> {
  id: string;
  run: CodexTask<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __petscapeCodexQueue: CodexSerialQueue | undefined;
}

export class CodexSerialQueue {
  private items: QueueItem<unknown>[] = [];
  private active?: string;

  enqueue<T>(id: string, run: CodexTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.items.push({ id, run: run as CodexTask<unknown>, resolve: resolve as (value: unknown) => void, reject });
      this.drain();
    });
  }

  position(id: string): number | undefined {
    if (this.active === id) return 0;
    const idx = this.items.findIndex((item) => item.id === id);
    return idx >= 0 ? idx + 1 : undefined;
  }

  private async drain() {
    if (this.active || this.items.length === 0) return;
    const item = this.items.shift()!;
    this.active = item.id;
    try {
      item.resolve(await item.run());
    } catch (error) {
      item.reject(error);
    } finally {
      this.active = undefined;
      this.drain();
    }
  }
}

export const codexQueue = globalThis.__petscapeCodexQueue ?? new CodexSerialQueue();
globalThis.__petscapeCodexQueue = codexQueue;
