export interface InterruptFrame {
  type: 'kill_response' | 'trick_response' | 'dying' | 'judge';
  data: unknown;
  resolve: (result: unknown) => void;
  reject: (reason: string) => void;
}

export class InterruptStack {
  private stack: InterruptFrame[] = [];

  async wait<T>(type: InterruptFrame['type'], data: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      this.stack.push({
        type,
        data,
        resolve: resolve as (r: unknown) => void,
        reject,
      });
    });
  }

  resolve(result: unknown): void {
    const frame = this.stack.pop();
    frame?.resolve(result);
  }

  current(): InterruptFrame | undefined {
    return this.stack[this.stack.length - 1];
  }

  isEmpty(): boolean {
    return this.stack.length === 0;
  }
}
