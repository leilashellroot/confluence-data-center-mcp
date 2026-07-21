# @leilashellroot/confluence-data-center-mcp

MCP server for Confluence Server/Data Center. It gives AI assistants access to content, spaces, comments, attachments, metadata, and complete document context through the Confluence REST API.

This project is an independent community package and is not affiliated with Atlassian.

This project is based on and credits [b1ff/atlassian-dc-mcp](https://github.com/b1ff/atlassian-dc-mcp).

## Features

- Content CRUD for pages, blog posts, and comments
- CQL content and space search
- Cursor-based content scanning
- Direct children, descendants, history, and historical versions
- Complete document context aggregation
- Root, nested, footer, inline, and resolved comment retrieval
- Attachments, labels, content properties, and restrictions
- Space listing, content listing, creation, updates, deletion, and archiving
- Watcher and user lookup
- stdio, legacy SSE, and Streamable HTTP transports
- Interactive and non-interactive secure setup

## Installation

```bash
npm install -g @leilashellroot/confluence-data-center-mcp
```

The server requires a Confluence Server/Data Center personal access token or API token.

## Configuration

The simplest configuration is:

```bash
export CONFLUENCE_BASE_URL=https://confluence.example.com
export CONFLUENCE_API_TOKEN=your-token
```

These equivalent names are also supported:

```bash
export CONFLUENCE_HOST=confluence.example.com
export CONFLUENCE_PAT=your-token
```

For an installation below a context path, use a full API base path:

```bash
export CONFLUENCE_API_BASE_PATH=https://confluence.example.com/wiki/rest/api
export CONFLUENCE_API_TOKEN=your-token
```

The server removes the final `/rest` or `/rest/api` suffix before constructing API requests.

Configuration precedence is process environment, `ATLASSIAN_DC_MCP_CONFIG_FILE` or the current directory `.env`, `~/.atlassian-dc-mcp/confluence.env`, then the macOS Keychain token.

`CONFLUENCE_DEFAULT_PAGE_SIZE` defaults to `25`. `ATLASSIAN_DC_MCP_REQUEST_TIMEOUT_MS` defaults to `30000`.

### Setup CLI

The setup command validates credentials against `/rest/api/user/current` and stores configuration in `~/.atlassian-dc-mcp/confluence.env` with mode `0600` on POSIX systems:

```bash
npx @leilashellroot/confluence-data-center-mcp setup
```

Scripted setup:

```bash
npx @leilashellroot/confluence-data-center-mcp setup --non-interactive \
  --host confluence.example.com \
  --token "$CONFLUENCE_TOKEN"
```

Available flags are `--host`/`-H`, `--api-base-path`/`-b`, `--token`/`-t`, `--default-page-size`/`-s`, `--non-interactive`/`-n`, and `--help`/`-h`.

On macOS, setup stores the token in the login Keychain under the `atlassian-dc-mcp` service and `confluence-token` account. On other systems it stores the token in the protected home configuration file.

## Usage

Direct stdio usage:

```bash
npx @leilashellroot/confluence-data-center-mcp
```

OpenCode, Cursor, or Claude Desktop:

```json
{
  "mcp": {
    "confluence": {
      "type": "local",
      "command": ["npx", "-y", "@leilashellroot/confluence-data-center-mcp"],
      "environment": {
        "CONFLUENCE_BASE_URL": "https://confluence.example.com",
        "CONFLUENCE_API_TOKEN": "your-token"
      },
      "enabled": true
    }
  }
}
```

After setup, credentials can be omitted from the MCP configuration:

```json
{
  "mcpServers": {
    "confluence": {
      "command": "npx",
      "args": ["-y", "@leilashellroot/confluence-data-center-mcp"]
    }
  }
}
```

## Full Context

`confluence_get_content_context` is the primary agent-oriented tool. It returns:

- The complete content object and complete storage-format body
- A derived plain-text document body
- All comment pages across pagination boundaries
- Footer, inline, and resolved comments
- Nested replies assembled into comment trees
- Inline properties and resolution metadata
- Author, timestamps, IDs, parent IDs, and raw Confluence fields
- Counts and query metadata showing the aggregation was complete

The context tool does not truncate the document or comments. Large pages can produce large MCP responses, so use `confluence_get_content` with `bodyMode` set to `text` or `none` for targeted reads.

## Tools

### Content

`confluence_get_content`, `confluence_get_content_context`, `confluence_search_content`, `confluence_scan_content`, `confluence_create_content`, `confluence_update_content`, `confluence_delete_content`, `confluence_get_children`, `confluence_get_descendants`, `confluence_get_history`, `confluence_get_content_version`, and `confluence_delete_content_version`.

### Comments

`confluence_get_comments`, `confluence_get_all_comments`, `confluence_create_comment`, `confluence_update_comment`, and `confluence_delete_comment`.

Comment bodies use Confluence storage format. Inline creation can pass `inlineProperties` when the target Data Center version supports the relevant inline-comment contract.

### Spaces

`confluence_get_spaces`, `confluence_search_spaces`, `confluence_get_space`, `confluence_get_space_content`, `confluence_create_space`, `confluence_update_space`, `confluence_delete_space`, and `confluence_archive_space`.

### Attachments and metadata

`confluence_get_attachments`, `confluence_get_attachment`, `confluence_add_attachment`, `confluence_update_attachment`, `confluence_update_attachment_data`, `confluence_delete_attachment`, `confluence_get_labels`, `confluence_add_labels`, `confluence_remove_label`, `confluence_get_content_properties`, `confluence_get_content_property`, `confluence_create_content_property`, `confluence_update_content_property`, and `confluence_delete_content_property`.

### Permissions and users

`confluence_get_restrictions`, `confluence_update_restrictions`, `confluence_get_watchers`, `confluence_get_current_user`, `confluence_get_user`, and `confluence_get_users`.

The original reference tool names remain available as compatibility aliases: `confluence_getContent`, `confluence_searchContent`, `confluence_createContent`, `confluence_updateContent`, and `confluence_searchSpace`.

## Remote Transports

Legacy SSE:

```bash
MCP_TRANSPORT=sse MCP_HOST=0.0.0.0 MCP_PORT=3000 \
  npx @leilashellroot/confluence-data-center-mcp
```

Streamable HTTP:

```bash
MCP_TRANSPORT=streamable-http MCP_HOST=0.0.0.0 MCP_PORT=3000 \
  npx @leilashellroot/confluence-data-center-mcp
```

Remote configuration variables:

| Variable | Default | Description |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio`, `sse`, or `streamable-http` |
| `MCP_HOST` | `127.0.0.1` | HTTP bind host |
| `MCP_PORT` | `3000` | HTTP port |
| `MCP_HTTP_PATH` | `/mcp` | Streamable HTTP endpoint |
| `MCP_SSE_PATH` | `/sse` | SSE endpoint |
| `MCP_MESSAGES_PATH` | `/messages` | SSE message endpoint |
| `MCP_ALLOWED_HOSTS` | unset | Comma-separated allowed Host values |
| `MCP_ALLOWED_ORIGINS` | unset | Comma-separated allowed Origin values |
| `MCP_CORS_ORIGIN` | unset | Optional CORS origin |

When binding beyond localhost, use HTTPS and put the server behind authentication. Every connected client uses the configured Confluence token.

## Development

```bash
npm install
npm test
npm run build
```

The test suite uses mocked REST responses and local HTTP servers. It does not require access to a Confluence instance.

## Publishing

The tag-triggered GitHub Actions workflow expects an npm access token in the repository secret named `NPM_TOKEN`. The token is supplied to npm through `NODE_AUTH_TOKEN` only during the publish step and is not stored in the repository.

## API References

- [Confluence Data Center REST API](https://developer.atlassian.com/server/confluence/rest/v931/)
- [Confluence Server REST API reference](https://docs.atlassian.com/ConfluenceServer/rest/8.9.0/)
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## License

MIT
