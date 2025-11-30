# Reflect MCP Server

A remote [MCP server](https://modelcontextprotocol.io/introduction) for [Reflect](https://reflect.app) that enables AI assistants like Claude to interact with your Reflect notes through OAuth authentication.


## Available Tools

- **`get_reflect_graphs`**: Get a list of all Reflect graphs accessible with your account
- **`append_to_reflect_daily_notes`**: Append content to your daily notes in a specific Reflect graph
  - `graph_id`: The graph identifier
  - `content`: Text/markdown to append
  - `date`: The date in ISO 8601 format (YYYY-MM-DD) — use the user's local date to avoid timezone issues

## Local Setup

### 1. Create a Reflect OAuth App

1. Go to your Reflect settings and create an OAuth application
2. Note your **Client ID** and **Client Secret**
3. Set your redirect URL based on your deployment:
   - **Remote**: `https://your-worker.your-subdomain.workers.dev/oauth/callback`
   - **Local**: `http://localhost:3000/oauth/callback`

### 2. Configure Environment Variables

Create a `.dev.vars` file for local development:

```bash
cp .dev.vars.example .dev.vars
```

Then fill in your credentials:

```
REFLECT_CLIENT_ID=your_reflect_client_id
REFLECT_CLIENT_SECRET=your_reflect_client_secret
COOKIE_ENCRYPTION_KEY=your_random_string
```

Generate a secure encryption key:
```bash
openssl rand -hex 32
```

## Running Locally

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Development Server

```bash
npm run dev
```

The server will start at `http://localhost:8787`.

### 3. Configure Claude Desktop for Local Use

Open Claude Desktop and navigate to **Settings → Developer → Edit Config**.

Update your configuration to point to the local server:

```json
{
  "mcpServers": {
    "reflect": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/sse"
      ]
    }
  }
}
```

Restart Claude Desktop. A browser window will open for Reflect OAuth authentication. After you grant access, the tools will be available.

> **Note**: Make sure your Reflect OAuth app has `http://localhost:8787/oauth/callback` as an allowed redirect URL.

## Testing with MCP Inspector

You can test the server using the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector):

```bash
npx @modelcontextprotocol/inspector@latest
```

Enter your server URL (`http://localhost:8787/sse` for local or your deployed URL) and connect.

## License

MIT
