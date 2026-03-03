/**
 * index.ts — Entry point for the AI Code Review Agent.
 *
 * This file wires everything together:
 *  1. Loads environment variables from .env (GITHUB_TOKEN, ANTHROPIC_API_KEY).
 *  2. Parses the GitHub PR URL from CLI arguments.
 *  3. Runs the agentic review loop via runReview().
 *  4. Prints the colored review to the console.
 *  5. Falls back to posting the PR comment itself if Claude didn't do it.
 */

import "dotenv/config";
import { Octokit } from "@octokit/rest";
import { PRInfo } from "./types";
import { runReview } from "./reviewer";
import { formatReviewAsMarkdown, formatReviewForConsole } from "./formatter";

export function parsePRInput(url: string): PRInfo {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) {
    throw new Error(
      `Invalid PR URL: "${url}".\n` +
        `Expected format: https://github.com/owner/repo/pull/123`
    );
  }

  return {
    owner: match[1],
    repo: match[2],
    pull_number: parseInt(match[3], 10),
  };
}

function validateEnv(): void {
  if (!process.env.GITHUB_TOKEN) {
    console.error("Missing GITHUB_TOKEN environment variable.");
    console.error("Create a .env file based on .env.example");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY environment variable.");
    console.error("Create a .env file based on .env.example");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npx ts-node src/index.ts <PR_URL>");
    console.error(
      "Example: npx ts-node src/index.ts https://github.com/owner/repo/pull/123"
    );
    process.exit(1);
  }

  validateEnv();

  const prInfo = parsePRInput(url);
  console.log(
    `Reviewing PR #${prInfo.pull_number} in ${prInfo.owner}/${prInfo.repo}...`
  );
  console.log("---");

  const { review, metrics } = await runReview(prInfo);

  // Print formatted review to console
  console.log("\n" + formatReviewForConsole(review));

  // If Claude didn't post the comment itself, post it as a fallback
  if (!metrics.comment_posted) {
    console.log("\n[Fallback] Claude didn't post the comment. Posting now...");
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const markdown = formatReviewAsMarkdown(review);
    const { data } = await octokit.rest.issues.createComment({
      owner: prInfo.owner,
      repo: prInfo.repo,
      issue_number: prInfo.pull_number,
      body: markdown,
    });
    console.log(`Comment posted: ${data.html_url}`);
  }

  console.log("\nReview complete.");
}

main().catch((err) => {
  console.error("Fatal error:", err.message || err);
  process.exit(1);
});
