import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { type Props,  ReflectHandler } from "./reflect-handler";

/**
 * Validates a date string in YYYY-MM-DD format and returns it if valid,
 * otherwise returns today's date in YYYY-MM-DD format.
 */
function getValidDate(dateInput?: string): string {
	if (dateInput) {
		// Check format: YYYY-MM-DD
		const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
		if (dateRegex.test(dateInput)) {
			// Check if it's a valid date
			const parsed = new Date(dateInput);
			if (!isNaN(parsed.getTime())) {
				return dateInput;
			}
		}
	}
	// Fallback: generate today's date in YYYY-MM-DD format
	const now = new Date();
	return now.toISOString().split('T')[0];
}

export class ReflectMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Reflect Assistant MCP",
		version: "1.0.0",
	});

	async init() {
		// Tool: Get all Reflect graphs
		this.server.tool(
			"get_reflect_graphs",
			"Get a list of all Reflect graphs accessible with the current access token. Retrieves all graphs from the Reflect API that the authenticated user has access to.",
			{},
			async () => {
				const accessToken = this.props?.accessToken;
				if (!accessToken) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: "Not authenticated. Please complete OAuth flow first." }),
							},
						],
					};
				}

				try {
					const response = await fetch("https://reflect.app/api/graphs", {
						headers: {
							Authorization: `Bearer ${accessToken}`,
						},
					});
					if (!response.ok) {
						throw new Error(`HTTP error! status: ${response.status}`);
					}
					const data = await response.json();
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(data),
							},
						],
					};
				} catch (e) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: String(e) }),
							},
						],
					};
				}
			}
		);

		// Tool: Append to Reflect daily notes
		this.server.tool(
			"append_to_reflect_daily_notes",
			"Append content and/or tasks to the daily notes in a specific Reflect graph. Must add the tasks field if there are any actionable items to add. Pass today's date in the user's local timezone to avoid timezone issues.",
			{
				content: z.string().optional().describe("The text content to append to the daily notes. Can be plain text or markdown formatted text."),
				tasks: z.array(z.string()).optional().describe("A list of tasks to add. Must add this field if there are any actionable items to add. Example: ['Buy groceries', 'Call mom']"),
				graph_id: z.string().describe("The unique identifier of the Reflect graph where the daily notes should be updated."),
				date: z.string().optional().describe("The date for the daily note in ISO 8601 format (YYYY-MM-DD). Use the user's local date. Example: '2025-11-30'. If omitted or invalid, defaults to today."),
			},
			async ({ content, tasks, graph_id, date }) => {
				const accessToken = this.props?.accessToken;
				if (!accessToken) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: "Not authenticated. Please complete OAuth flow first." }),
							},
						],
					};
				}

				// Validate date format, fallback to today if invalid
				const validDate = getValidDate(date);

				// Build the text: combine content and tasks
				const parts: string[] = [];
				if (content) {
					parts.push(content);
				}
				if (tasks && tasks.length > 0) {
					// Format each task with "+ " prefix for Reflect task syntax
					const formattedTasks = tasks.map(task => `+ ${task}`).join('\n');
					parts.push(formattedTasks);
				}
				const textToAppend = parts.join('\n');

				if (!textToAppend) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: "Either content or tasks must be provided." }),
							},
						],
					};
				}

				try {
					const response = await fetch(`https://reflect.app/api/graphs/${graph_id}/daily-notes`, {
						method: "PUT",
						headers: {
							Authorization: `Bearer ${accessToken}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							date: validDate,
							text: textToAppend,
							transform_type: "list-append",
							list_name: "[[Claude-Notes]]",
						}),
					});
					if (!response.ok) {
						throw new Error(`HTTP error! status: ${response.status}`);
					}
					const data = await response.json();
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(data),
							},
						],
					};
				} catch (e) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ error: String(e) }),
							},
						],
					};
				}
			}
		);
	}
}

export default new OAuthProvider({
	apiHandler: ReflectMCP.serve("/mcp") as any,
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: ReflectHandler as any,
	tokenEndpoint: "/token",
});
