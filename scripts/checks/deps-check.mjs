import { readJson, runCheck, walkFiles } from "./lib.mjs";

const bannedDependencies = new Set(["pg", "postgres", "redis", "ioredis", "nats", "kafkajs", "pgvector", "react-native", "expo", "next"]);
const dependencySections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function parseArgs(argv) {
  const fixtureIndex = argv.indexOf("--fixture");
  return fixtureIndex === -1 ? {} : { fixture: argv[fixtureIndex + 1] };
}

await runCheck("check:deps", async function checkDeps() {
  const { fixture } = parseArgs(process.argv.slice(2));
  const packageFiles = fixture ? [fixture.replaceAll("\\", "/")] : ["package.json", ...(await walkFiles("apps", { extensions: [".json"] })), ...(await walkFiles("packages", { extensions: [".json"] }))].filter((file) => file.endsWith("package.json"));
  const errors = [];

  for (const file of packageFiles) {
    const manifest = await readJson(file);
    for (const section of dependencySections) {
      const deps = manifest[section] ?? {};
      for (const dependency of Object.keys(deps)) {
        if (bannedDependencies.has(dependency)) errors.push(`banned dependency: ${dependency} in ${file} ${section}`);
      }
    }
  }

  checkDeps.detail = `${packageFiles.length} package manifest${packageFiles.length === 1 ? "" : "s"} scanned`;
  return errors;
});
