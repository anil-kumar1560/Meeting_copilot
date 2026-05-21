"""
rag.py

ChromaDB-backed retrieval-augmented generation helpers.

Responsibilities:
- Chunk documents with tiktoken (cl100k_base, 500-token chunks, 50-token overlap)
- Embed chunks with OpenAI text-embedding-3-small
- Store / query / delete embeddings in a persistent ChromaDB collection
"""

import os
from typing import Any

import chromadb
import tiktoken
from chromadb.utils import embedding_functions
from openai import OpenAI

# ---------------------------------------------------------------------------
# Module-level singletons
# ---------------------------------------------------------------------------

_CHROMA_PATH = "./chroma_db"
_COLLECTION_NAME = "meeting_knowledge"
_EMBED_MODEL = "text-embedding-3-small"
_CHUNK_SIZE = 500       # tokens
_CHUNK_OVERLAP = 50     # tokens

_openai_client = OpenAI()  # reads OPENAI_API_KEY from env

_chroma_client = chromadb.PersistentClient(path=_CHROMA_PATH)

# Use OpenAI embedding function provided by chromadb so that queries are
# embedded automatically when we call collection.query().
_openai_ef = embedding_functions.OpenAIEmbeddingFunction(
    api_key=os.getenv("OPENAI_API_KEY", ""),
    model_name=_EMBED_MODEL,
)

_collection = _chroma_client.get_or_create_collection(
    name=_COLLECTION_NAME,
    embedding_function=_openai_ef,
    metadata={"hnsw:space": "cosine"},
)

_tokenizer = tiktoken.get_encoding("cl100k_base")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _chunk_text(text: str) -> list[str]:
    """Split *text* into token-bounded chunks with overlap."""
    tokens = _tokenizer.encode(text)
    chunks: list[str] = []
    start = 0
    while start < len(tokens):
        end = start + _CHUNK_SIZE
        chunk_tokens = tokens[start:end]
        chunk_text = _tokenizer.decode(chunk_tokens)
        chunks.append(chunk_text)
        if end >= len(tokens):
            break
        start = end - _CHUNK_OVERLAP
    return chunks


def _make_chunk_id(filename: str, chunk_index: int) -> str:
    """Stable document-chunk identifier."""
    safe_name = filename.replace("/", "_").replace("\\", "_")
    return f"{safe_name}__chunk_{chunk_index}"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def ingest_document(
    text: str, filename: str, topic_tags: list[str] | None = None
) -> int:
    """
    Chunk *text*, embed the chunks, and store them in ChromaDB.

    Args:
        text:       Full plain-text content of the document.
        filename:   Original filename (used as metadata and ID prefix).
        topic_tags: Optional list of topic tags to attach as metadata.

    Returns:
        Number of chunks stored.
    """
    if topic_tags is None:
        topic_tags = []

    chunks = _chunk_text(text)
    if not chunks:
        return 0

    ids: list[str] = []
    documents: list[str] = []
    metadatas: list[dict[str, Any]] = []

    for idx, chunk in enumerate(chunks):
        ids.append(_make_chunk_id(filename, idx))
        documents.append(chunk)
        metadatas.append(
            {
                "filename": filename,
                "topic_tags": ",".join(topic_tags),  # ChromaDB metadata must be scalar
                "chunk_index": idx,
            }
        )

    # Upsert so re-ingesting the same document overwrites existing chunks
    _collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
    return len(chunks)


async def retrieve_context(
    query: str, topic_tags: list[str] | None = None, n_results: int = 4
) -> str:
    """
    Embed *query* and retrieve the most relevant chunks from ChromaDB.

    Args:
        query:      Text to embed and search for.
        topic_tags: If non-empty, restrict results to chunks whose
                    topic_tags metadata overlaps with any tag in the list.
        n_results:  Maximum number of chunks to return.

    Returns:
        Concatenated chunk texts separated by double newlines, or an empty
        string if nothing is found.
    """
    if topic_tags is None:
        topic_tags = []

    total_docs = _collection.count()
    if total_docs == 0:
        return ""

    n_results = min(n_results, total_docs)

    where_filter: dict[str, Any] | None = None
    if topic_tags:
        # Build an $or filter — each tag is checked with $contains
        if len(topic_tags) == 1:
            where_filter = {"topic_tags": {"$contains": topic_tags[0]}}
        else:
            where_filter = {
                "$or": [{"topic_tags": {"$contains": tag}} for tag in topic_tags]
            }

    try:
        query_kwargs: dict[str, Any] = {
            "query_texts": [query],
            "n_results": n_results,
        }
        if where_filter:
            query_kwargs["where"] = where_filter

        results = _collection.query(**query_kwargs)
        docs: list[str] = results.get("documents", [[]])[0]
        return "\n\n".join(docs)
    except Exception:
        # Fall back to unfiltered query if the filtered one fails
        try:
            results = _collection.query(query_texts=[query], n_results=n_results)
            docs = results.get("documents", [[]])[0]
            return "\n\n".join(docs)
        except Exception:
            return ""


def get_document_list() -> list[dict]:
    """
    Return a list of unique filenames stored in the collection together
    with the number of chunks each has.

    Returns:
        List of dicts: [{"filename": str, "chunks": int}, ...]
    """
    total = _collection.count()
    if total == 0:
        return []

    # Fetch all metadatas (no document content needed)
    results = _collection.get(include=["metadatas"])
    metadatas: list[dict] = results.get("metadatas") or []

    counts: dict[str, int] = {}
    for meta in metadatas:
        fname = meta.get("filename", "unknown")
        counts[fname] = counts.get(fname, 0) + 1

    return [{"filename": fname, "chunks": count} for fname, count in sorted(counts.items())]


def delete_document(filename: str) -> bool:
    """
    Delete all chunks belonging to *filename* from ChromaDB.

    Returns:
        True if any chunks were deleted, False if none were found.
    """
    try:
        results = _collection.get(where={"filename": filename}, include=["metadatas"])
        ids_to_delete: list[str] = results.get("ids") or []
        if not ids_to_delete:
            return False
        _collection.delete(ids=ids_to_delete)
        return True
    except Exception:
        return False
