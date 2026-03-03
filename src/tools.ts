/**
 * tools.ts — Tool definitions and GitHub API implementations.
 *
 * This file has two responsibilities:
 *  1. Defines the JSON Schema tool objects that Claude sees in each API call
 *     (toolDefinitions array). These tell Claude what tools are available and
 *     what parameters each one accepts.
 *  2. Implements each tool by wrapping GitHub REST API calls via Octokit.
 *     The executeTool() dispatcher routes tool names to their handlers.
 *
 * All tool implementations are wrapped in try/catch — errors are returned
 * as plain strings so Claude can reason about them rather than crashing.
 * Large diffs and patches are truncated to stay within context limits.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import {
  ToolName,
  FetchPRDiffInput,
  GetFileContentInput,
  ListPRFilesInput,
  PostReviewCommentInput,
} from "./types";

const MAX_DIFF_LENGTH = 30_000;
const MAX_PATCH_LENGTH = 3_000;

// --- Tool definitions (JSON schemas Claude sees) ---

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "fetch_pr_diff",
    description:
      "Fetches the full unified diff of a pull request. Returns the raw diff text showing all changed files with their additions and deletions. Use this first to get an overview of all changes.",
    input_schema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Repository owner (user or org)" },
        repo: { type: "string", description: "Repository name" },
        pull_number: { type: "number", description: "Pull request number" },
      },
      required: ["owner", "repo", "pull_number"],
    },
  },
  {
    name: "get_file_content",
    description:
      "Retrieves the full content of a specific file at a specific git ref (branch or commit SHA). Use this to read the complete source code of a file when the diff alone is insufficient for review.",
    input_schema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Repository owner" },
        repo: { type: "string", description: "Repository name" },
        path: {
          type: "string",
          description: "File path relative to repo root",
        },
        ref: {
          type: "string",
          description: "Git ref (branch name or commit SHA) to read the file from",
        },
      },
      required: ["owner", "repo", "path", "ref"],
    },
  },
  {
    name: "list_pr_files",
    description:
      "Lists all files changed in a pull request with their status (added, modified, removed), additions/deletions counts, and patch content. Use this to understand the scope of changes and decide which files to review in detail.",
    input_schema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Repository owner" },
        repo: { type: "string", description: "Repository name" },
        pull_number: { type: "number", description: "Pull request number" },
      },
      required: ["owner", "repo", "pull_number"],
    },
  },
  {
    name: "post_review_comment",
    description:
      "Posts a comment on the pull request. Use this ONLY when you have completed your review and are ready to post the final formatted review. The body should be a well-structured markdown comment.",
    input_schema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "Repository owner" },
        repo: { type: "string", description: "Repository name" },
        pull_number: { type: "number", description: "Pull request number" },
        body: {
          type: "string",
          description: "The markdown-formatted review comment body",
        },
      },
      required: ["owner", "repo", "pull_number", "body"],
    },
  },
];

// --- Tool execution ---

export async function executeTool(
  octokit: Octokit,
  toolName: ToolName,
  toolInput: Record<string, unknown>
): Promise<string> {
  switch (toolName) {
    case "fetch_pr_diff":
      return fetchPRDiff(octokit, toolInput as unknown as FetchPRDiffInput);
    case "get_file_content":
      return getFileContent(octokit, toolInput as unknown as GetFileContentInput);
    case "list_pr_files":
      return listPRFiles(octokit, toolInput as unknown as ListPRFilesInput);
    case "post_review_comment":
      return postReviewComment(
        octokit,
        toolInput as unknown as PostReviewCommentInput
      );
    default:
      return `Error: Unknown tool "${toolName}"`;
  }
}

async function fetchPRDiff(
  octokit: Octokit,
  input: FetchPRDiffInput
): Promise<string> {
  try {
    const { data } = await octokit.rest.pulls.get({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pull_number,
      mediaType: { format: "diff" },
    });

    let diff = data as unknown as string;
    if (diff.length > MAX_DIFF_LENGTH) {
      diff =
        diff.substring(0, MAX_DIFF_LENGTH) +
        "\n\n... [diff truncated. Use get_file_content to inspect specific files.]";
    }
    return diff;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error fetching PR diff: ${message}`;
  }
}

async function getFileContent(
  octokit: Octokit,
  input: GetFileContentInput
): Promise<string> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: input.owner,
      repo: input.repo,
      path: input.path,
      ref: input.ref,
    });

    if (Array.isArray(data)) {
      return `Error: "${input.path}" is a directory, not a file.`;
    }

    if (!("content" in data) || !data.content) {
      return `Error: No content available for "${input.path}".`;
    }

    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error fetching file content: ${message}`;
  }
}

async function listPRFiles(
  octokit: Octokit,
  input: ListPRFilesInput
): Promise<string> {
  try {
    const { data } = await octokit.rest.pulls.listFiles({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pull_number,
      per_page: 100,
    });

    const files = data.map((file) => {
      let patch = file.patch || "";
      if (patch.length > MAX_PATCH_LENGTH) {
        patch =
          patch.substring(0, MAX_PATCH_LENGTH) +
          "\n... [patch truncated]";
      }

      return [
        `## ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})`,
        patch ? `\`\`\`diff\n${patch}\n\`\`\`` : "(binary or empty file)",
      ].join("\n");
    });

    return `${data.length} files changed:\n\n${files.join("\n\n")}`;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error listing PR files: ${message}`;
  }
}

async function postReviewComment(
  octokit: Octokit,
  input: PostReviewCommentInput
): Promise<string> {
  try {
    const { data } = await octokit.rest.issues.createComment({
      owner: input.owner,
      repo: input.repo,
      issue_number: input.pull_number,
      body: input.body,
    });

    return `Review comment posted successfully: ${data.html_url}`;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error posting review comment: ${message}`;
  }
}
