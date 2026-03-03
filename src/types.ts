/**
 * types.ts — Shared TypeScript interfaces for the entire project.
 *
 * This is the foundational file that every other module imports from.
 * It defines:
 *  1. PRInfo — identifies a GitHub pull request (parsed from the CLI URL).
 *  2. Tool input types — the shape of each tool's parameters.
 *  3. Review output types — the structured JSON that Claude produces.
 *  4. AgentMetrics — tracks loop progress (tool calls, tokens, iterations).
 */

export interface PRInfo {
  owner: string;
  repo: string;
  pull_number: number;
}

// Tool input types
export interface FetchPRDiffInput {
  owner: string;
  repo: string;
  pull_number: number;
}

export interface GetFileContentInput {
  owner: string;
  repo: string;
  path: string;
  ref: string;
}

export interface ListPRFilesInput {
  owner: string;
  repo: string;
  pull_number: number;
}

export interface PostReviewCommentInput {
  owner: string;
  repo: string;
  pull_number: number;
  body: string;
}

// Review output types
export type Severity = "critical" | "warning" | "info";
export type Category =
  | "security"
  | "performance"
  | "style"
  | "bug"
  | "best-practice";

export interface ReviewFinding {
  severity: Severity;
  category: Category;
  file: string;
  line_number: number | null;
  title: string;
  description: string;
  suggestion: string;
}

export interface ReviewResult {
  summary: string;
  findings: ReviewFinding[];
  files_reviewed: string[];
  overall_assessment: "approve" | "request_changes" | "comment";
}

// Agent loop tracking
export interface AgentMetrics {
  tool_calls_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  iterations: number;
  files_inspected: Set<string>;
  comment_posted: boolean;
}

export type ToolName =
  | "fetch_pr_diff"
  | "get_file_content"
  | "list_pr_files"
  | "post_review_comment";
