export type ActiveWake = {
  readonly roomId: string;
  readonly agentId: string;
  runId?: string;
  readonly idempotencyKey: string;
  readonly startedAt: number;
};

export type ActiveWakeGuard =
  | { readonly kind: "already_active"; readonly existingRunId: string }
  | { readonly kind: "acquired"; bindToRun: (runId: string) => void; release: () => void };

export class ActiveWakesRegistry {
  private readonly wakes = new Map<string, ActiveWake>();

  constructor(private readonly now: () => number = Date.now) {}

  tryAcquire(roomId: string, agentId: string, idempotencyKey: string): ActiveWakeGuard {
    const key = registryKey(roomId, agentId);
    const existing = this.wakes.get(key);
    if (existing?.runId) {
      return { kind: "already_active", existingRunId: existing.runId };
    }
    if (existing) {
      return { kind: "already_active", existingRunId: existing.runId ?? "" };
    }

    let released = false;
    this.wakes.set(key, { roomId, agentId, idempotencyKey, startedAt: this.now() });
    return {
      kind: "acquired",
      bindToRun: (runId: string) => {
        if (released) return;
        const wake = this.wakes.get(key);
        if (wake) wake.runId = runId;
      },
      release: () => {
        released = true;
        this.wakes.delete(key);
      }
    };
  }

  releaseRun(runId: string): void {
    for (const [key, wake] of this.wakes) {
      if (wake.runId === runId) {
        this.wakes.delete(key);
      }
    }
  }

  rebuildFromRuns(runs: readonly { readonly room_id: string; readonly agent_id: string; readonly id: string; readonly wake_reason: string | null }[]): void {
    this.wakes.clear();
    for (const run of runs) {
      this.wakes.set(registryKey(run.room_id, run.agent_id), {
        roomId: run.room_id,
        agentId: run.agent_id,
        runId: run.id,
        idempotencyKey: `recovered:${run.id}`,
        startedAt: this.now()
      });
    }
  }

  has(roomId: string, agentId: string): boolean {
    return this.wakes.has(registryKey(roomId, agentId));
  }
}

function registryKey(roomId: string, agentId: string): string {
  return `${roomId}:${agentId}`;
}
