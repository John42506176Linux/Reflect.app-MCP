import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { type Props,  ReflectHandler } from "./reflect-handler";


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
			"Append content to the daily notes in a specific Reflect graph. Adds text content to today's daily notes page in the specified Reflect graph.",
			{
				content: z.string().describe("The text content to append to the daily notes. Can be plain text or markdown formatted text."),
				graph_id: z.string().describe("The unique identifier of the Reflect graph where the daily notes should be updated."),
			},
			async ({ content, graph_id }) => {
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
					const response = await fetch(`https://reflect.app/api/graphs/${graph_id}/daily-notes`, {
						method: "PUT",
						headers: {
							Authorization: `Bearer ${accessToken}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							text: content,
							transform_type: "list-append",
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
