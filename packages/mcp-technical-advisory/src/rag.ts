import { basename } from "node:path";
import { Storage } from "@google-cloud/storage";
import { PageIndexClient } from "@pageindex/sdk";
import { ValidationError, createLogger, toError } from "@mcpkit/utils";

const log = createLogger("mcp-technical-advisory.rag");

const GCS_DOWNLOAD_MAX_ATTEMPTS = 3;
const GCS_DOWNLOAD_RETRY_DELAY_MS = 1_000;
const PAGEINDEX_POLL_MAX_ATTEMPTS = 10;
const PAGEINDEX_POLL_INTERVAL_MS = 3_000;

type PageIndexStatus = "queued" | "processing" | "completed" | "failed" | string;

type PageIndexTreeNode = {
  title?: string;
  node_id?: string;
  page_index?: number;
  text?: string;
  nodes?: PageIndexTreeNode[];
  [key: string]: unknown;
};

type PageIndexTreeResponse = {
  doc_id: string;
  status: PageIndexStatus;
  result?: PageIndexTreeNode[];
  [key: string]: unknown;
};

type PageIndexDocumentResponse = {
  id: string;
  name: string;
  status: PageIndexStatus;
  createdAt?: string;
  pageNum?: number;
  [key: string]: unknown;
};

type PageIndexChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  [key: string]: unknown;
};

type PageIndexApi = {
  submitDocument: (
    file: Buffer | ArrayBuffer,
    fileName: string,
    options?: {
      mode?: string;
      folderId?: string;
    },
  ) => Promise<{ doc_id: string }>;
  getTree: (
    docId: string,
    options?: {
      nodeSummary?: boolean;
    },
  ) => Promise<PageIndexTreeResponse>;
  getDocument: (docId: string) => Promise<PageIndexDocumentResponse>;
  chatCompletions: (request: {
    messages: Array<{ role: string; content: string }>;
    doc_id: string | string[];
    temperature?: number;
    enable_citations?: boolean;
    stream?: false;
  }) => Promise<PageIndexChatResponse>;
};

type PageIndexClientLike = {
  api: PageIndexApi;
};

/**
 * In-memory metadata stored for each indexed PDF.
 */
export type DocumentCacheEntry = {
  doc_id: string;
  indexed_at: Date;
  file_name: string;
};

/**
 * Result returned after attempting to index a single document.
 */
export type IndexDocumentResult = {
  entry: DocumentCacheEntry;
  source: "indexed" | "cached";
};

/**
 * Aggregate outcome for a sequential bulk indexing run.
 */
export type IndexAllPdfsSummary = {
  bucket_name: string;
  prefix: string | null;
  total_discovered: number;
  indexed: string[];
  cached: string[];
  failed: Array<{
    blob_name: string;
    error: string;
  }>;
};

/**
 * Side-by-side answer set returned by `compareDocuments`.
 */
export type CompareDocumentsResult = Array<{
  doc: string;
  answer: string;
}>;

type TechnicalAdvisoryRagOptions = {
  gcsBucketName: string;
  defaultGcsPrefix?: string;
  pageIndexApiKey: string;
  googleApplicationCredentials?: string;
};

/**
 * Lightweight async delay used by retry and polling loops.
 *
 * @param ms Milliseconds to wait before resolving.
 * @returns Promise that resolves after the requested delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Validates and normalizes a GCS object name for a PDF document.
 *
 * @param blobName Raw blob name received from a tool call.
 * @returns Trimmed blob name.
 * @throws ValidationError When the input is empty or does not point to a PDF.
 */
function normalizeBlobName(blobName: string): string {
  const normalizedBlobName = blobName.trim();

  if (!normalizedBlobName) {
    throw new ValidationError("blob_name is required");
  }

  if (!normalizedBlobName.toLowerCase().endsWith(".pdf")) {
    throw new ValidationError("blob_name must point to a .pdf object in GCS");
  }

  return normalizedBlobName;
}

/**
 * Validates a user question before it is sent to PageIndex.
 *
 * @param question Raw question string.
 * @returns Trimmed question.
 * @throws ValidationError When the question is empty.
 */
function normalizeQuestion(question: string): string {
  const normalizedQuestion = question.trim();

  if (!normalizedQuestion) {
    throw new ValidationError("question is required");
  }

  return normalizedQuestion;
}

/**
 * Trims an optional GCS prefix and converts empty strings into `undefined`.
 *
 * @param prefix Optional prefix from configuration or tool input.
 * @returns Normalized prefix or `undefined` when not provided.
 */
function normalizePrefix(prefix?: string): string | undefined {
  const normalizedPrefix = prefix?.trim();
  return normalizedPrefix ? normalizedPrefix : undefined;
}

/**
 * Encapsulates the technical-advisory RAG workflow:
 * downloading PDFs from GCS, indexing them with PageIndex, and answering
 * questions against the in-memory cache of indexed documents.
 */
export class TechnicalAdvisoryRag {
  // The cache is intentionally process-local. Restarting the server drops all doc_id mappings.
  private readonly storage: Storage;
  private readonly bucketName: string;
  private readonly defaultGcsPrefix?: string;
  private readonly pageIndexClient: PageIndexClientLike;
  private readonly documentCache = new Map<string, DocumentCacheEntry>();
  private readonly inFlightIndexes = new Map<string, Promise<IndexDocumentResult>>();

  constructor({
    gcsBucketName,
    defaultGcsPrefix,
    pageIndexApiKey,
    googleApplicationCredentials,
  }: TechnicalAdvisoryRagOptions) {
    this.bucketName = gcsBucketName;
    this.defaultGcsPrefix = normalizePrefix(defaultGcsPrefix);
    this.storage = new Storage(
      googleApplicationCredentials
        ? { keyFilename: googleApplicationCredentials }
        : undefined,
    );
    this.pageIndexClient = new PageIndexClient({
      apiKey: pageIndexApiKey,
    }) as unknown as PageIndexClientLike;
  }

  /**
   * Lists all blob names currently cached by this running process.
   *
   * @returns Sorted blob names for indexed documents.
   */
  listIndexedDocuments(): string[] {
    return Array.from(this.documentCache.keys()).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  /**
   * Indexes a single PDF unless it has already been cached in this process.
   *
   * @param blobName GCS object name for the PDF to index.
   * @returns Cache metadata together with whether the result was reused or newly indexed.
   */
  async indexDocument(blobName: string): Promise<IndexDocumentResult> {
    const normalizedBlobName = normalizeBlobName(blobName);
    const cachedEntry = this.documentCache.get(normalizedBlobName);

    if (cachedEntry) {
      return {
        entry: cachedEntry,
        source: "cached",
      };
    }

    const existingIndexOperation = this.inFlightIndexes.get(normalizedBlobName);

    if (existingIndexOperation) {
      return existingIndexOperation;
    }

    const indexOperation = this.performIndexDocument(normalizedBlobName).finally(() => {
      this.inFlightIndexes.delete(normalizedBlobName);
    });

    this.inFlightIndexes.set(normalizedBlobName, indexOperation);
    return indexOperation;
  }

  /**
   * Sends a question to PageIndex for a previously indexed document.
   *
   * @param blobName GCS object name already present in the in-memory cache.
   * @param question User question to ask about the document.
   * @returns Answer text returned by PageIndex.
   */
  async queryDocument(blobName: string, question: string): Promise<string> {
    const normalizedBlobName = normalizeBlobName(blobName);
    const normalizedQuestion = normalizeQuestion(question);
    const entry = this.getCachedEntry(normalizedBlobName);

    const response = await this.pageIndexClient.api.chatCompletions({
      messages: [{ role: "user", content: normalizedQuestion }],
      doc_id: entry.doc_id,
      temperature: 0.1,
    });

    const answer = response.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      throw new Error(
        `PageIndex returned an empty answer for "${normalizedBlobName}" (doc_id: ${entry.doc_id})`,
      );
    }

    return answer;
  }

  /**
   * Indexes every PDF in the configured bucket or under a specific prefix.
   *
   * @param prefix Optional prefix override for this indexing run.
   * @returns Summary containing indexed, cached, and failed files.
   */
  async indexAllPdfs(prefix?: string): Promise<IndexAllPdfsSummary> {
    const effectivePrefix = normalizePrefix(prefix) ?? this.defaultGcsPrefix;
    const blobNames = await this.listPdfBlobNames(effectivePrefix);
    const indexed: string[] = [];
    const cached: string[] = [];
    const failed: IndexAllPdfsSummary["failed"] = [];

    for (const blobName of blobNames) {
      try {
        const result = await this.indexDocument(blobName);

        if (result.source === "cached") {
          cached.push(blobName);
        } else {
          indexed.push(blobName);
        }
      } catch (error) {
        failed.push({
          blob_name: blobName,
          error: toError(error).message,
        });
      }
    }

    return {
      bucket_name: this.bucketName,
      prefix: effectivePrefix ?? null,
      total_discovered: blobNames.length,
      indexed,
      cached,
      failed,
    };
  }

  /**
   * Runs the same question against multiple indexed documents and returns
   * each answer independently so clients can compare them side by side.
   *
   * @param blobNames Indexed document names to compare.
   * @param question Shared question applied to every document.
   * @returns Per-document answers, including inline error text when one fails.
   */
  async compareDocuments(blobNames: string[], question: string): Promise<CompareDocumentsResult> {
    const normalizedQuestion = normalizeQuestion(question);
    const comparisons: CompareDocumentsResult = [];

    for (const blobName of blobNames) {
      try {
        const answer = await this.queryDocument(blobName, normalizedQuestion);
        comparisons.push({
          doc: normalizeBlobName(blobName),
          answer,
        });
      } catch (error) {
        comparisons.push({
          doc: blobName.trim(),
          answer: `Error: ${toError(error).message}`,
        });
      }
    }

    return comparisons;
  }

  /**
   * Returns the raw PageIndex tree for an indexed document.
   *
   * @param blobName GCS object name already present in the in-memory cache.
   * @returns Completed PageIndex tree response, including node summaries.
   */
  async getDocumentTree(blobName: string): Promise<PageIndexTreeResponse> {
    const normalizedBlobName = normalizeBlobName(blobName);
    const entry = this.getCachedEntry(normalizedBlobName);
    const tree = await this.pageIndexClient.api.getTree(entry.doc_id, {
      nodeSummary: true,
    });

    if (tree.status === "failed") {
      throw new Error(
        `PageIndex reported a failed tree for "${normalizedBlobName}" (doc_id: ${entry.doc_id})`,
      );
    }

    if (tree.status !== "completed") {
      throw new Error(
        `Document "${normalizedBlobName}" is not ready yet. Current status: ${tree.status}`,
      );
    }

    return tree;
  }

  /**
   * Performs the actual download and PageIndex submission for a document.
   *
   * @param blobName GCS object name for the PDF.
   * @returns Newly created cache entry.
   */
  private async performIndexDocument(blobName: string): Promise<IndexDocumentResult> {
    log.info("Indexing document", {
      blobName,
      bucketName: this.bucketName,
    });

    // We only ever submit the PDF bytes directly from GCS; nothing is persisted locally.
    const fileBuffer = await this.downloadPdfFromGcs(blobName);
    const fileName = basename(blobName);
    const { doc_id } = await this.pageIndexClient.api.submitDocument(fileBuffer, fileName, {
      mode: "mcp",
    });

    await this.pollUntilDocumentIsReady(doc_id, blobName);

    const entry: DocumentCacheEntry = {
      doc_id,
      indexed_at: new Date(),
      file_name: fileName,
    };

    this.documentCache.set(blobName, entry);

    log.info("Indexed document successfully", {
      blobName,
      docId: doc_id,
    });

    return {
      entry,
      source: "indexed",
    };
  }

  /**
   * Downloads a PDF from Google Cloud Storage with retry handling.
   *
   * @param blobName GCS object name for the PDF.
   * @returns Raw PDF bytes as a Buffer.
   */
  private async downloadPdfFromGcs(blobName: string): Promise<Buffer> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= GCS_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
      try {
        const [buffer] = await this.storage.bucket(this.bucketName).file(blobName).download();
        return buffer;
      } catch (error) {
        lastError = toError(error);

        log.warn("Failed to download PDF from GCS", {
          blobName,
          attempt,
          bucketName: this.bucketName,
          error: lastError.message,
        });

        if (attempt < GCS_DOWNLOAD_MAX_ATTEMPTS) {
          await sleep(GCS_DOWNLOAD_RETRY_DELAY_MS);
        }
      }
    }

    throw new Error(
      `Unable to download "${blobName}" from GCS bucket "${this.bucketName}" after ${GCS_DOWNLOAD_MAX_ATTEMPTS} attempts: ${lastError?.message ?? "unknown error"}`,
    );
  }

  /**
   * Lists PDF object names in the configured bucket.
   *
   * @param prefix Optional GCS prefix filter.
   * @returns Sorted PDF object names.
   */
  private async listPdfBlobNames(prefix?: string): Promise<string[]> {
    const [files] = await this.storage.bucket(this.bucketName).getFiles(
      prefix ? { prefix } : undefined,
    );

    return files
      .map((file) => file.name)
      .filter((name) => name.toLowerCase().endsWith(".pdf"))
      .sort((left, right) => left.localeCompare(right));
  }

  /**
   * Polls PageIndex until a submitted document finishes indexing.
   *
   * @param docId PageIndex document identifier.
   * @param blobName Source blob name used for error messages.
   * @returns Completed PageIndex tree response.
   */
  private async pollUntilDocumentIsReady(
    docId: string,
    blobName: string,
  ): Promise<PageIndexTreeResponse> {
    let lastStatus: PageIndexStatus | undefined;

    // PageIndex trees are built asynchronously, so we poll until the document is ready.
    for (let attempt = 1; attempt <= PAGEINDEX_POLL_MAX_ATTEMPTS; attempt += 1) {
      const tree = await this.pageIndexClient.api.getTree(docId, {
        nodeSummary: true,
      });

      lastStatus = tree.status;

      if (tree.status === "completed") {
        return tree;
      }

      if (tree.status === "failed") {
        const metadata = await this.getDocumentMetadataSafe(docId);
        const documentName = metadata?.name ? ` (${metadata.name})` : "";

        throw new Error(
          `PageIndex failed to index "${blobName}"${documentName}. doc_id: ${docId}`,
        );
      }

      if (attempt < PAGEINDEX_POLL_MAX_ATTEMPTS) {
        await sleep(PAGEINDEX_POLL_INTERVAL_MS);
      }
    }

    throw new Error(
      `Timed out waiting for PageIndex to finish "${blobName}". Last status: ${lastStatus ?? "unknown"}. doc_id: ${docId}`,
    );
  }

  /**
   * Looks up a cached entry and raises a helpful error when the document
   * has not been indexed in the current server process.
   *
   * @param blobName GCS object name for the indexed PDF.
   * @returns Cached document metadata.
   */
  private getCachedEntry(blobName: string): DocumentCacheEntry {
    const entry = this.documentCache.get(blobName);

    if (!entry) {
      throw new Error(`Document "${blobName}" is not indexed yet. Run index_document first.`);
    }

    return entry;
  }

  /**
   * Fetches PageIndex document metadata without masking the primary operation
   * when metadata lookup itself fails.
   *
   * @param docId PageIndex document identifier.
   * @returns Document metadata when available, otherwise `undefined`.
   */
  private async getDocumentMetadataSafe(
    docId: string,
  ): Promise<PageIndexDocumentResponse | undefined> {
    try {
      return await this.pageIndexClient.api.getDocument(docId);
    } catch (error) {
      log.warn("Unable to fetch PageIndex document metadata", {
        docId,
        error: toError(error).message,
      });

      return undefined;
    }
  }
}
