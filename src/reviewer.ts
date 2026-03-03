/**
 * reviewer.ts — Core agentic loop for the code review agent.
 *
 * This is the heart of the system. Unlike a simple chat where the user
 * drives the conversation, here Claude drives it autonomously:
 *  1. Sends an initial message asking Claude to review the PR.
 *  2. Claude responds with tool calls (list files, fetch diff, etc.).
 *  3. We execute the tools and send results back.
 *  4. Loop continues until Claude's stop_reason is "end_turn".
 *
 * Key design decisions:
 *  - Extended thinking is enabled (budget_tokens: 10000) so Claude can
 *    reason deeply between tool calls about code patterns and security.
 *  - The full response.content (including thinking blocks) is preserved
 *    in the message history — this is required by the Anthropic API.
 *  - Stopping conditions (max tool calls, token budget) inject a "wrap up"
 *    message rather than hard-cutting, giving Claude a chance to produce
 *    a valid structured review even when hitting limits.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import { PRInfo, ReviewResult, AgentMetrics, ToolName } from "./types";
import { toolDefinitions, executeTool } from "./tools";
import { getSystemPrompt } from "./prompts";

const MAX_TOOL_CALLS = 20;
const MAX_TOTAL_TOKENS = 50_000;
const MODEL = "claude-sonnet-4-6";

export async function runReview(
  prInfo: PRInfo
): Promise<{ review: ReviewResult; metrics: AgentMetrics }> {
  const anthropic = new Anthropic();
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const metrics: AgentMetrics = {
    tool_calls_count: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    iterations: 0,
    files_inspected: new Set<string>(),
    comment_posted: false,
  };

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Please review pull request #${prInfo.pull_number} in ${prInfo.owner}/${prInfo.repo}. Start by listing the changed files, then fetch the diff, inspect files that need deeper review, and provide your complete analysis. When done, post the review as a PR comment.`,
    },
  ];

  const systemPrompt = getSystemPrompt(prInfo);

  while (true) {
    metrics.iterations++;

    // Stopping condition: too many tool calls
    if (metrics.tool_calls_count >= MAX_TOOL_CALLS) {
      console.log(
        `\n[Agent] Reached max tool calls (${MAX_TOOL_CALLS}). Asking Claude to wrap up.`
      );
      messages.push({
        role: "user",
        content:
          "You have reached the maximum number of tool calls. Please provide your final review now as JSON, without making any more tool calls.",
      });
    }

    // Stopping condition: token budget
    if (
      metrics.total_input_tokens + metrics.total_output_tokens >=
      MAX_TOTAL_TOKENS
    ) {
      console.log(
        `\n[Agent] Approaching token budget (${MAX_TOTAL_TOKENS}). Asking Claude to wrap up.`
      );
      messages.push({
        role: "user",
        content:
          "You are approaching the token budget limit. Please finalize your review now as JSON.",
      });
    }

    // Hard stop to prevent infinite loops
    if (metrics.iterations > MAX_TOOL_CALLS + 3) {
      console.log("\n[Agent] Hard stop: too many iterations.");
      break;
    }

    console.log(`\n[Agent] Iteration ${metrics.iterations}...`);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: systemPrompt,
      thinking: {
        type: "enabled",
        budget_tokens: 10000,
      },
      tools: toolDefinitions,
      messages,
    });

    // Track token usage
    metrics.total_input_tokens += response.usage.input_tokens;
    metrics.total_output_tokens += response.usage.output_tokens;

    // Log thinking blocks (truncated)
    for (const block of response.content) {
      if (block.type === "thinking") {
        const preview = block.thinking.substring(0, 150).replace(/\n/g, " ");
        console.log(`[Thinking] ${preview}...`);
      }
      if (block.type === "text") {
        const preview = block.text.substring(0, 150).replace(/\n/g, " ");
        console.log(`[Text] ${preview}...`);
      }
    }

    // Agent finished — parse the final review
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === "text"
      );

      if (textBlock) {
        const review = parseReviewJSON(textBlock.text);
        console.log(
          `\n[Agent] Review complete. ${metrics.iterations} iterations, ${metrics.tool_calls_count} tool calls, ${metrics.total_input_tokens + metrics.total_output_tokens} tokens used.`
        );
        return { review, metrics };
      }

      throw new Error("Claude ended turn without providing review text.");
    }

    // Agent wants to call tools
    if (response.stop_reason === "tool_use") {
      // Push the full assistant response (preserves thinking blocks)
      messages.push({
        role: "assistant",
        content: response.content,
      });

      // Extract and execute all tool_use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        metrics.tool_calls_count++;
        const input = toolUse.input as Record<string, unknown>;

        console.log(
          `[Tool ${metrics.tool_calls_count}/${MAX_TOOL_CALLS}] ${toolUse.name}(${summarizeInput(input)})`
        );

        // Track file inspections
        if (input.path && typeof input.path === "string") {
          metrics.files_inspected.add(input.path);
        }

        // Track if comment was posted
        if (toolUse.name === "post_review_comment") {
          metrics.comment_posted = true;
        }

        const result = await executeTool(
          octokit,
          toolUse.name as ToolName,
          input
        );

        // Log truncated result
        console.log(
          `[Result] ${result.substring(0, 100).replace(/\n/g, " ")}${result.length > 100 ? "..." : ""}`
        );

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      // Send tool results back
      messages.push({
        role: "user",
        content: toolResults,
      });

      continue;
    }

    // Unexpected stop reason
    console.warn(`[Agent] Unexpected stop_reason: ${response.stop_reason}`);
    break;
  }

  throw new Error("Agent loop exited without producing a review.");
}

function parseReviewJSON(text: string): ReviewResult {
  // Try to extract JSON from ```json code fence
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]) as ReviewResult;
    } catch {
      // Fall through to other strategies
    }
  }

  // Try parsing the entire text as JSON
  try {
    return JSON.parse(text) as ReviewResult;
  } catch {
    // Last resort: return a minimal review with the raw text
    return {
      summary: text.substring(0, 500),
      findings: [],
      files_reviewed: [],
      overall_assessment: "comment",
    };
  }
}

function summarizeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 50) {
      parts.push(`${key}: "${value.substring(0, 50)}..."`);
    } else {
      parts.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return parts.join(", ");
}
