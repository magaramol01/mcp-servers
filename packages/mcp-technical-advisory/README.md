# mcp-technical-advisory

`mcp-technical-advisory` is a production-oriented MCP server that reads PDF documents from Google Cloud Storage, indexes them with PageIndex's vectorless RAG workflow, and exposes MCP tools over Streamable HTTP for clients such as Claude Desktop and Cursor.

## Setup

This monorepo uses `pnpm` workspaces, so use `pnpm install` here rather than `npm install`.

```bash
pnpm install
cp packages/mcp-technical-advisory/.env.example packages/mcp-technical-advisory/.env
pnpm turbo run build --filter=@mcpkit/mcp-technical-advisory
node packages/mcp-technical-advisory/dist/index.js
```

Example `packages/mcp-technical-advisory/.env`:

```dotenv
PAGEINDEX_API_KEY=your_pageindex_api_key
GCS_BUCKET_NAME=your_gcs_bucket_name
TECHNICAL_ADVISORY_GCS_PREFIX=optional/gcs/prefix/
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
GEMINI_API_KEY=your_gemini_api_key
TECHNICAL_ADVISORY_HOST=0.0.0.0
TECHNICAL_ADVISORY_PORT=3000
LOG_LEVEL=info
```

The server listens on `http://localhost:3000/mcp` by default.

For local development in this repo, the server also auto-detects
`packages/mcp-technical-advisory/key/ssh-marine-5047e738d9ee.json` when
`GOOGLE_APPLICATION_CREDENTIALS` is not set.

If your PDFs live under a folder-like path inside the bucket, set
`TECHNICAL_ADVISORY_GCS_PREFIX` so `index_all_pdfs` can use that prefix by default.

## Register The Server

Claude Desktop:

```json
{
  "mcpServers": {
    "mcp-technical-advisory": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

Cursor:

```json
{
  "mcpServers": {
    "mcp-technical-advisory": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

## Available Tools

### `index_document`

Indexes a single PDF from the configured GCS bucket.

```json
{
  "blob_name": "manuals/boiler-control-manual.pdf"
}
```

### `query_document`

Asks a question about an already indexed PDF.

```json
{
  "blob_name": "manuals/boiler-control-manual.pdf",
  "question": "What are the startup safety checks for the boiler control system?"
}
```

### `list_indexed_documents`

Lists all blob names currently cached in memory.

```json
{}
```

### `index_all_pdfs`

Indexes every PDF in the bucket, optionally restricted to a prefix.

```json
{
  "prefix": "manuals/"
}
```

### `compare_documents`

Runs the same question against multiple indexed PDFs and returns side-by-side answers.

```json
{
  "blob_names": [
    "specs/pump-a.pdf",
    "specs/pump-b.pdf"
  ],
  "question": "Which pump has the higher maximum discharge pressure?"
}
```

### `get_document_tree`

Returns the raw PageIndex tree, including node summaries, for an indexed PDF.

```json
{
  "blob_name": "reports/site-reliability-review.pdf"
}
```

### `get_technical_advisory_playbook`

Returns a machine-readable JSON playbook with environment requirements,
storage semantics, cache behavior, and recommended workflows for this server.

```json
{}
```

The same content is also available as the MCP resource
`technical-advisory://playbook`.

## GCS Permissions

The service account used by `GOOGLE_APPLICATION_CREDENTIALS` needs these bucket-level permissions:

- `storage.objects.get`
- `storage.objects.list`

## Notes

- All document caching is in-memory only and resets when the process restarts.
- `index_all_pdfs` runs sequentially to keep indexing predictable and easier to operate.
- The server uses Streamable HTTP only. There is no stdio transport.
