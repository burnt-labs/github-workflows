import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  applyStack,
  assertApplicable,
  assertInvocation,
  credentialEnvironment,
  loadTerragruntPolicy,
  planStack,
  renderSummary,
  resolveStack,
} from "./terragrunt.mjs";

function output(name, value) {
  if (!process.env.GITHUB_OUTPUT)
    throw new Error("Terragrunt GITHUB_OUTPUT is required");
  const delimiter = `EOF_${crypto.randomBytes(16).toString("hex")}`;
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `${name}<<${delimiter}\n${value}\n${delimiter}\n`,
  );
}

function stepSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

function mask(values) {
  for (const value of values)
    for (const line of value.split(/\r?\n/))
      if (line.trim()) process.stdout.write(`::add-mask::${line}\n`);
}

try {
  const [command, flow] = process.argv.slice(2);
  if (
    process.argv.length !== 4 ||
    !["resolve", "plan", "apply"].includes(command) ||
    !["pr", "main"].includes(flow) ||
    (command === "apply" && flow !== "main")
  )
    throw new Error(
      "Terragrunt command must be resolve|plan <pr|main> or apply main",
    );
  const root = process.cwd();
  const allowDestroy = process.env.TERRAGRUNT_ALLOW_DESTROY === "true";
  if (
    !["true", "false", undefined].includes(process.env.TERRAGRUNT_ALLOW_DESTROY)
  )
    throw new Error("Terragrunt allow-destroy must be true or false");
  assertInvocation(flow, {
    eventName: process.env.SOURCE_EVENT,
    ref: process.env.SOURCE_REF,
    defaultBranch: process.env.DEFAULT_BRANCH,
    allowDestroy,
  });
  const policy = loadTerragruntPolicy(
    root,
    process.env.TERRAGRUNT_POLICY_PATH || undefined,
  );
  const resolved = resolveStack(root, policy, process.env.TERRAGRUNT_STACK);

  if (command === "resolve") {
    output(
      "stack",
      JSON.stringify({
        workingDirectory: resolved.workingDirectory,
        awsRegion: resolved.awsRegion,
        terraformVersion: resolved.terraformVersion,
        terragruntVersion: resolved.terragruntVersion,
        plan: {
          githubEnvironment: resolved.plan.githubEnvironment,
          awsRoleArn: resolved.plan.awsRoleArn,
        },
        apply: {
          githubEnvironment: resolved.apply.githubEnvironment,
          awsRoleArn: resolved.apply.awsRoleArn,
        },
      }),
    );
  } else {
    const stageName = command === "apply" ? "apply" : "plan";
    const { env, masks } = credentialEnvironment(resolved, stageName, {
      allSecrets: process.env.ALL_SECRETS,
      namedCloudflareToken: process.env.NAMED_CLOUDFLARE_API_TOKEN,
      base: process.env,
    });
    mask(masks);
    if (!process.env.RUNNER_TEMP)
      throw new Error("Terragrunt RUNNER_TEMP is required");
    const planFile = path.join(
      process.env.RUNNER_TEMP,
      `terragrunt-${resolved.stack}.tfplan`,
    );
    const summary = planStack(root, resolved, {
      env,
      planFile,
      lock: command === "apply" ? true : resolved.plan.lock,
    });
    const markdown = renderSummary(summary, {
      stack: resolved.stack,
      workingDirectory: resolved.workingDirectory,
      sha: process.env.SOURCE_SHA,
      runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      heading:
        command === "apply" ? "Terragrunt apply plan" : "Terragrunt plan",
    });
    stepSummary(markdown);
    if (command === "plan") {
      output("summary", markdown);
      output("fingerprint", summary.fingerprint);
      output("has-changes", String(summary.hasChanges));
      output("destructive", String(summary.destructive.length > 0));
      if (
        summary.destructive.length &&
        resolved.plan.failOnDestroyOrReplace &&
        !allowDestroy
      )
        throw new Error(
          `Terragrunt plan destroys or replaces: ${summary.destructive.join(", ")}`,
        );
    } else {
      assertApplicable(summary, {
        reviewedFingerprint: process.env.REVIEWED_FINGERPRINT,
        allowDestroy,
      });
      applyStack(root, resolved, { env, planFile });
    }
  }
} catch (error) {
  // Errors carry names and addresses only, never credential values.
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
