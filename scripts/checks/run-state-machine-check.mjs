import { readText, runCheck, walkFiles } from "./lib.mjs";

const requiredMethods = [
  "create",
  "markWaiting",
  "markClaimed",
  "markStarting",
  "markRunning",
  "markWaitingPermission",
  "markCancelling",
  "complete",
  "fail",
  "cancelFinalized",
  "updateSessionState"
];
const requiredStatuses = ["queued", "waiting", "claimed", "starting", "running", "waiting_permission", "cancelling", "completed", "failed", "cancelled"];
const requiredEvents = ["agent.run.queued", "agent.run.waiting", "agent.run.started", "agent.run.waiting_permission", "agent.run.resumed", "agent.run.completed", "agent.run.failed", "agent.run.cancelled"];

await runCheck("run-state-machine:check", async function checkRunStateMachine() {
  const errors = [];
  const busSpec = await readText("openspec/specs/bus-runtime/spec.md");
  const schema = await readText("packages/db/src/schema.ts");
  const registry = await readText("packages/protocol/src/events/registry.ts");

  for (const method of requiredMethods) {
    if (!busSpec.includes(`${method}(`)) errors.push(`RunLifecycleService spec missing method '${method}'`);
  }
  for (const status of requiredStatuses) {
    if (!busSpec.includes(status)) errors.push(`RunLifecycleService spec missing status '${status}'`);
  }
  for (const event of requiredEvents) {
    if (!registry.includes(`type: "${event}"`)) errors.push(`run lifecycle event '${event}' missing from protocol registry`);
  }

  for (const column of ["status", "wakeReason", "waitingReason", "adapterSessionId", "failureClass", "pidAtStart", "claimedAt"]) {
    if (!schema.includes(`${column}:`)) errors.push(`runs table Drizzle schema missing '${column}' column needed by run state machine skeleton`);
  }

  const lifecycleFiles = (await walkFiles("packages", { extensions: [".ts"] })).filter((file) => /run-lifecycle|RunLifecycle/.test(file));
  for (const file of lifecycleFiles) {
    const source = await readText(file);
    for (const method of requiredMethods) {
      if (!new RegExp(`${method}\\s*\\(`).test(source)) errors.push(`${file} exists but does not expose RunLifecycleService method '${method}'`);
    }
  }

  checkRunStateMachine.detail = lifecycleFiles.length === 0 ? "spec and schema skeleton checked; implementation not present yet" : `${lifecycleFiles.length} lifecycle implementation files`;
  return errors;
});
