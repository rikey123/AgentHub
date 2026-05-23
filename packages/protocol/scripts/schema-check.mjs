import { checkProtocolSchemas } from "../src/events/checks.ts";

const result = checkProtocolSchemas();

if (!result.ok) {
  process.stderr.write(`schema:check failed\n${result.errors.map((error) => `- ${error}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`schema:check passed (${result.checkedEventTypes} event types)\n`);
}
