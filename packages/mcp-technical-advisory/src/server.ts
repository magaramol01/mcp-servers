import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLogger, toError } from "@mcpkit/utils";
import { z } from "zod";
import {
  MCP_SERVER_INSTRUCTIONS,
  registerAgentPlaybookSurface,
} from "./agent/playbook.js";
import type { TechnicalAdvisoryRag } from "./rag.js";

const log = createLogger("mcp-technical-advisory.server");

const indexDocumentInputShape = {
  blob_name: z
    .string()
    .trim()
    .min(1)
    .describe("GCS blob name for the PDF that should be indexed"),
};
const indexDocumentInputSchema = z.object(indexDocumentInputShape);

const queryDocumentInputShape = {
  blob_name: z
    .string()
    .trim()
    .min(1)
    .describe("GCS blob name for a previously indexed PDF"),
  question: z
    .string()
    .trim()
    .min(1)
    .describe("Question to ask about the indexed document"),
};
const queryDocumentInputSchema = z.object(queryDocumentInputShape);

const emptyInputShape = {};
const emptyInputSchema = z.object(emptyInputShape);

const indexAllPdfsInputShape = {
  prefix: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional GCS prefix used to limit which PDFs are indexed"),
};
const indexAllPdfsInputSchema = z.object(indexAllPdfsInputShape);

const compareDocumentsInputShape = {
  blob_names: z
    .array(z.string().trim().min(1))
    .min(1)
    .describe("List of indexed GCS blob names to compare"),
  question: z
    .string()
    .trim()
    .min(1)
    .describe("Question to ask each indexed document"),
};
const compareDocumentsInputSchema = z.object(compareDocumentsInputShape);

const getDocumentTreeInputShape = {
  blob_name: z
    .string()
    .trim()
    .min(1)
    .describe("GCS blob name for a previously indexed PDF"),
};
const getDocumentTreeInputSchema = z.object(getDocumentTreeInputShape);

type TextToolResult = {
  content: Array<{
    type: "text";
    text: string;
  }>;
};

/**
 * Wraps plain text into the MCP tool result envelope expected by clients.
 *
 * @param text Response text for the tool call.
 * @returns MCP text content payload.
 */
function textResult(text: string): TextToolResult {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

/**
 * Serializes structured data into a pretty-printed text payload so MCP
 * clients can render it consistently.
 *
 * @param payload Structured response object.
 * @returns MCP text content payload.
 */
function jsonResult(payload: unknown): TextToolResult {
  return textResult(JSON.stringify(payload, null, 2));
}

/**
 * Converts any handler failure into the error text contract required by this
 * server instead of allowing exceptions to escape the MCP boundary.
 *
 * @param toolName Tool name used for logging.
 * @param error Caught error value from the handler.
 * @returns MCP error payload with a human-readable message.
 */
function errorResult(toolName: string, error: unknown): TextToolResult {
  const err = toError(error);

  log.error(`${toolName} failed`, {
    error: err.message,
  });

  return textResult(`Error: ${err.message}`);
}

/**
 * Creates the MCP server instance and registers the technical-advisory tools.
 *
 * @param rag Shared RAG service used by every tool handler in the session.
 * @returns Configured MCP server instance.
 */
export function createMcpServer(rag: TechnicalAdvisoryRag): McpServer {
  const server = new McpServer(
    {
      name: "mcp-technical-advisory",
      version: "1.0.0",
    },
    { instructions: MCP_SERVER_INSTRUCTIONS },
  );

  registerAgentPlaybookSurface(server);

  server.tool(
    "index_document",
    "Download a PDF from GCS, submit it to PageIndex, and cache the resulting doc_id in memory.",
    indexDocumentInputShape,
    async (input) => {
      try {
        const { blob_name } = indexDocumentInputSchema.parse(input);
        const result = await rag.indexDocument(blob_name);

        if (result.source === "cached") {
          return textResult(
            `Document "${blob_name}" is already indexed. doc_id: ${result.entry.doc_id}`,
          );
        }

        return textResult(
          `Indexed "${blob_name}" successfully. doc_id: ${result.entry.doc_id}`,
        );
      } catch (error) {
        return errorResult("index_document", error);
      }
    },
  );

  server.tool(
    "query_document",
    "Ask a question about a previously indexed document using PageIndex chat completions.",
    queryDocumentInputShape,
    async (input) => {
      try {
        const { blob_name, question } = queryDocumentInputSchema.parse(input);
        const answer = await rag.queryDocument(blob_name, question);
        return textResult(answer);
      } catch (error) {
        return errorResult("query_document", error);
      }
    },
  );

  server.tool(
    "list_indexed_documents",
    "List all blob names currently cached in memory for this running server process.",
    emptyInputShape,
    async (input) => {
      try {
        emptyInputSchema.parse(input ?? {});
        return jsonResult(rag.listIndexedDocuments());
      } catch (error) {
        return errorResult("list_indexed_documents", error);
      }
    },
  );

  server.tool(
    "index_all_pdfs",
    "List PDFs in the configured GCS bucket and index them sequentially, optionally filtering by prefix.",
    indexAllPdfsInputShape,
    async (input) => {
      try {
        const { prefix } = indexAllPdfsInputSchema.parse(input ?? {});
        const summary = await rag.indexAllPdfs(prefix);
        return jsonResult(summary);
      } catch (error) {
        return errorResult("index_all_pdfs", error);
      }
    },
  );

  server.tool(
    "compare_documents",
    "Ask the same question of multiple indexed documents and return side-by-side answers.",
    compareDocumentsInputShape,
    async (input) => {
      try {
        const { blob_names, question } = compareDocumentsInputSchema.parse(input);
        const comparison = await rag.compareDocuments(blob_names, question);
        return jsonResult(comparison);
      } catch (error) {
        return errorResult("compare_documents", error);
      }
    },
  );

  server.tool(
    "get_document_tree",
    "Return the raw PageIndex tree for an indexed document, including node summaries.",
    getDocumentTreeInputShape,
    async (input) => {
      try {
        const { blob_name } = getDocumentTreeInputSchema.parse(input);
        const tree = await rag.getDocumentTree(blob_name);
        return jsonResult(tree);
      } catch (error) {
        return errorResult("get_document_tree", error);
      }
    },
  );

  return server;
}
