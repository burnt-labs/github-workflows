import fs from "node:fs";
import process from "node:process";
import {
  assertReviewedSource,
  deployModal,
  loadModalPolicy,
  resolveModalDeployment,
} from "./modal.mjs";

try {
  const command = process.argv[2];
  if (process.argv.length !== 3 || !["plan", "deploy"].includes(command))
    throw new Error("Modal command must be plan or deploy");
  const root = process.cwd();
  assertReviewedSource(root, {
    eventName: process.env.SOURCE_EVENT,
    ref: process.env.SOURCE_REF,
    defaultBranch: process.env.DEFAULT_BRANCH,
    sourceSha: process.env.SOURCE_SHA,
  });
  const policy = loadModalPolicy(
    root,
    process.env.MODAL_POLICY_PATH || undefined,
  );
  const plan = resolveModalDeployment(
    root,
    policy,
    process.env.MODAL_TARGET,
    process.env.MODAL_IMAGE_TAG,
  );
  if (command === "plan") {
    if (!process.env.GITHUB_OUTPUT)
      throw new Error("Modal GITHUB_OUTPUT is required");
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `plan=${JSON.stringify({ githubEnvironment: plan.githubEnvironment, pythonVersion: plan.pythonVersion })}\n`,
    );
  } else {
    deployModal(plan, {
      python: process.env.MODAL_PYTHON,
      tokenId: process.env.MODAL_TOKEN_ID,
      tokenSecret: process.env.MODAL_TOKEN_SECRET,
    });
  }
} catch (error) {
  // Validation errors never include configuration contents or credential values.
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
