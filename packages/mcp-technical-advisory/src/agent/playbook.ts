import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const PLAYBOOK_URI = "technical-advisory://playbook";

function buildPlaybookPayload(): Record<string, unknown> {
  return {
    server: "mcpkit/mcp-technical-advisory",
    environment: {
      requiredAtStartup: ["PAGEINDEX_API_KEY", "GCS_BUCKET_NAME"],
      optional: [
        "TECHNICAL_ADVISORY_GCS_PREFIX",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GEMINI_API_KEY",
        "TECHNICAL_ADVISORY_HOST",
        "TECHNICAL_ADVISORY_PORT",
        "HOST",
        "PORT",
        "LOG_LEVEL",
      ],
      bucketMeaning:
        "GCS_BUCKET_NAME may be either a plain bucket name or a gs://bucket/prefix reference. Any embedded path segment is treated as the default prefix for index_all_pdfs.",
      credentialsFallback:
        "If GOOGLE_APPLICATION_CREDENTIALS is not set, the server falls back to the repo-local service account file when present.",
    },
    storage: {
      provider: "Google Cloud Storage",
      supportedFileTypes: [".pdf"],
      defaultPrefixEnv: "TECHNICAL_ADVISORY_GCS_PREFIX",
      requiredPermissions: ["storage.objects.get", "storage.objects.list"],
      note: "index_all_pdfs lists PDFs sequentially under the resolved bucket and optional prefix.",
    },
    rag: {
      provider: "PageIndex",
      mode: "vectorless RAG",
      cache: {
        type: "Map<string, { doc_id, indexed_at, file_name }>",
        scope: "process-local in-memory cache",
        resetBehavior: "Cache is cleared when the MCP process restarts.",
      },
      indexingBehavior: {
        gcsDownloadRetries: 3,
        pageIndexPollAttempts: 10,
        pageIndexPollIntervalSeconds: 3,
      },
      queryBehavior: {
        requiresIndexedDocument: true,
        compareDocumentsStrategy:
          "Each document is queried independently with the same question.",
      },
    },
    workflows: [
      {
        goal: "Ask a question about one PDF",
        steps: [
          "index_document",
          "get_document_tree (optional, for structure and summaries)",
          "query_document",
        ],
      },
      {
        goal: "Bulk prepare a folder of PDFs",
        steps: [
          "index_all_pdfs — uses the provided prefix or the configured default prefix",
          "list_indexed_documents",
        ],
      },
      {
        goal: "Compare multiple technical reports or manuals",
        steps: ["index_document for each PDF (or index_all_pdfs)", "compare_documents"],
      },
    ],
    toolsByDomain: {
      indexing: ["index_document", "index_all_pdfs"],
      querying: ["query_document", "compare_documents"],
      inspection: ["list_indexed_documents", "get_document_tree"],
      agentSurface: ["get_technical_advisory_playbook"],
    },
    resources: {
      playbookUri: PLAYBOOK_URI,
      note: "Read this URI via MCP resources/read for the same JSON as get_technical_advisory_playbook.",
    },
  };
}

/**
 * Returns the machine-readable playbook JSON shared by the MCP resource and helper tool.
 *
 * @returns Pretty-printed playbook JSON.
 */
export function getPlaybookJsonText(): string {
  return JSON.stringify(buildPlaybookPayload(), null, 2);
}

export const MCP_SERVER_INSTRUCTIONS = [
  "Technical-advisory MCP: vectorless PDF RAG over Google Cloud Storage using PageIndex.",
  "Requires env PAGEINDEX_API_KEY and GCS_BUCKET_NAME at process startup.",
  "Index documents before querying them; use get_document_tree when you need document structure first.",
  "For environment details, storage semantics, and recommended workflows, call get_technical_advisory_playbook or read resource technical-advisory://playbook.",
].join("\n");

/**
 * Registers the technical-advisory playbook as both an MCP resource and a helper tool.
 *
 * @param server MCP server instance that should expose the playbook surface.
 */
export function registerAgentPlaybookSurface(server: McpServer): void {
  const text = getPlaybookJsonText();

  server.registerResource(
    "technical_advisory_playbook",
    PLAYBOOK_URI,
    {
      description:
        "Machine-readable workflows, environment variables, storage semantics, and tool guidance for the technical advisory server",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text,
        },
      ],
    }),
  );

  server.tool(
    "get_technical_advisory_playbook",
    "Return JSON describing the technical advisory server environment variables, storage semantics, cache behavior, and recommended workflows.",
    {},
    async () => ({
      content: [{ type: "text", text }],
    }),
  );
}
