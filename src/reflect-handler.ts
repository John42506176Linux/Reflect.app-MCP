import { env } from "cloudflare:workers";
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { getUpstreamAuthorizeUrl } from "./utils";
import {
	addApprovedClient,
	bindStateToSession,
	createOAuthState,
	generateCSRFProtection,
	isClientApproved,
	OAuthError,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils";

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
export type Props = {
	accessTokenId: string;
	accessToken: string;
};

const app = new Hono<{
	Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers };
}>();

/**
 * OAuth Authorization Endpoint
 *
 * This route initiates the Reflect OAuth flow when a user wants to log in.
 * It shows an approval dialog with client information and CSRF protection
 * before redirecting to Reflect's authorization page.
 */
app.get("/authorize", async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		return c.text("Invalid request", 400);
	}

	// Check if client is already approved
	if (await isClientApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
		// Skip approval dialog but still create secure state and bind to session
	}

	// Generate CSRF protection for the approval form
	const { token: csrfToken, setCookie } = generateCSRFProtection();

	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		csrfToken,
		server: {
			description: "This MCP Server is For Reflect OAuth.",
			name: "Reflect MCP Server",
		},
		setCookie,
		state: { oauthReqInfo },
	});
});

app.post("/authorize", async (c) => {
	try {
		// Read form data once
		const formData = await c.req.raw.formData();

		// Validate CSRF token
		validateCSRFToken(formData, c.req.raw);

		// Extract state from form data
		const encodedState = formData.get("state");
		if (!encodedState || typeof encodedState !== "string") {
			return c.text("Missing state in form data", 400);
		}

		let state: { oauthReqInfo?: AuthRequest };
		try {
			state = JSON.parse(atob(encodedState));
		} catch (_e) {
			return c.text("Invalid state data", 400);
		}

		if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
			return c.text("Invalid request", 400);
		}

		// Add client to approved list
		const approvedClientCookie = await addApprovedClient(
			c.req.raw,
			state.oauthReqInfo.clientId,
			c.env.COOKIE_ENCRYPTION_KEY,
		);

		// Create OAuth state and bind it to this user's session
		const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie: sessionCookie } = await bindStateToSession(stateToken);

		// Set both cookies: approved client list + session binding
		const headers = new Headers();
		headers.append("Set-Cookie", approvedClientCookie);
		headers.append("Set-Cookie", sessionCookie);

		return redirectToReflect(c.req.raw, stateToken, Object.fromEntries(headers));
	} catch (error: any) {
		console.error("POST /authorize error:", error);
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		// Unexpected non-OAuth error
		return c.text(`Internal server error: ${error.message}`, 500);
	}
});

function redirectToReflect(
	request: Request,
	stateToken: string,
	headers: Record<string, string> = {},
) {
	return new Response(null, {
		headers: {
			...headers,
			location: getUpstreamAuthorizeUrl({
				client_id: env.REFLECT_CLIENT_ID,
				redirect_uri: new URL("/oauth/callback", request.url).href,
				scope: "read:graph,write:graph",
				upstream_url: "https://reflect.app/oauth",
				response_type: "code",
				state: stateToken,
			}),
		},
		status: 302,
	});
}

type ReflectOauthTokenResponse =
	| {
			access_token: string;
			access_token_id: string;
	  }
	| {
			error: string;
	  };

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from Reflect after user authentication.
 * It validates the state parameter, exchanges the temporary code for an access token,
 * then stores user metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 *
 * SECURITY: This endpoint validates that the state parameter from Reflect
 * matches both:
 * 1. A valid state token in KV (proves it was created by our server)
 * 2. The __Host-CONSENTED_STATE cookie (proves THIS browser consented to it)
 *
 * This prevents CSRF attacks where an attacker's state token is injected
 * into a victim's OAuth flow.
 */
app.get("/oauth/callback", async (c) => {
	// Validate OAuth state with session binding
	// This checks both KV storage AND the session cookie
	let oauthReqInfo: AuthRequest;
	let clearSessionCookie: string;

	try {
		const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
		oauthReqInfo = result.oauthReqInfo;
		clearSessionCookie = result.clearCookie;
	} catch (error: any) {
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		// Unexpected non-OAuth error
		return c.text("Internal server error", 500);
	}

	if (!oauthReqInfo.clientId) {
		return c.text("Invalid OAuth request data", 400);
	}

	// Exchange the code for an access token
	const code = c.req.query("code");
	if (!code) {
		return c.text("Missing code", 400);
	}

	console.log("Attempting token exchange with params:", {
		code_exists: !!code,
		redirect_uri: new URL("/oauth/callback", c.req.url).href,
	});

	// Exchange the code for an access token
	const response = await fetch("https://reflect.app/api/oauth/token", {
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code: code,
			client_id: c.env.REFLECT_CLIENT_ID,
			client_secret: c.env.REFLECT_CLIENT_SECRET,
			redirect_uri: new URL("/oauth/callback", c.req.url).href,
		}).toString(),
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		method: "POST",
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.log("Token exchange failed:", response.status, errorText);
		return c.text(`Failed to fetch access token: ${response.status} ${errorText}`, 500);
	}

	const data = (await response.json()) as ReflectOauthTokenResponse;

	const accessToken = (data as { access_token: string }).access_token;
	const accessTokenId = (data as { access_token_id: string }).access_token_id;
	if (!accessToken) {
		return c.text("Missing access token", 400);
	}

	console.log("Completing authorization with user:", accessTokenId);

	// Return back to the MCP client a new token
	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		metadata: {
			label: accessTokenId,
		},
		// This will be available on this.props inside ReflectMCP
		props: {
			accessToken,
			accessTokenId,
		} as Props,
		request: oauthReqInfo,
		scope: oauthReqInfo.scope,
		userId: accessTokenId,
	});

	// Clear the session binding cookie (one-time use) by creating response with headers
	const headers = new Headers({ Location: redirectTo });
	if (clearSessionCookie) {
		headers.set("Set-Cookie", clearSessionCookie);
	}

	return new Response(null, {
		status: 302,
		headers,
	});
});

export const ReflectHandler = app;
