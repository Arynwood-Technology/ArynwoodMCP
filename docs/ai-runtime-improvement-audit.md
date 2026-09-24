# Arynwood AI runtime improvement audit

Reviewed 2026-09-23. Scope: source-level review of chat, providers, memory, knowledge retrieval, MCP execution, relevant UI flows, and tests. This is not a live quality benchmark or an exhaustive review of every studio integration. No application code or live user data was changed.

The largest opportunity is improving the runtime around the model: preserving information, supplying relevant evidence, executing tools correctly, and checking outcomes. Memory and retrieval do not change model weights. They make information available at inference time. These improvements can benefit different models, although weaker models will still have different capability limits.

## Evidence and existing strengths

The app already implements semantic memory indexing, pinned and provisional memories, transient-memory expiry during automatic retrieval, conflict detection for new memories, conversation summaries, knowledge source versioning, lexical reranking of vector candidates, tool selection, approvals, repeat-call detection, optional fallback models, and Prometheus metrics. Improve these foundations rather than replacing them wholesale.

Ran the following existing tests: token budgets, history summaries, relevant memories, memory confirmation, volatility/conflicts, knowledge retrieval, streaming replies, MCP tool agent, tool validation, and model escalation. **62 passed**, with one Starlette/httpx deprecation warning. Tests use a temporary database. Live-model evaluations and GPU workflows were not run.

Additional isolated, non-network reproductions confirmed:

- A streamed structured `tool_calls` field becomes only `{'token': '', 'done': True}` in `ollama_client.chat_stream`.
- An image-only MCP result becomes `(no output)` in `_result_to_text`.
- `_trim_history_to_tokens` retains a 100-estimated-token message with a zero-token budget.

Measured shipped prompts using the app's own approximate token estimator, including its default environment/project layout but no memories/history: central ~3,832 tokens; Glyph ~3,004; other personas ~2,100–2,440. These are estimates, not tokenizer measurements, and runtime trimming changes them.

## Priority 0: correctness before additional intelligence features

### 1. Preserve structured model events

**Observed:** `backend/services/ollama_client.py:111` yields only content and done. `backend/routers/chat.py:978` reconstructs calls by parsing text. This loses actual structured tool calls from models that emit them, despite the non-streaming path preserving tool calls.

**Change:** Normalize text deltas, tool-call deltas, completion reasons, usage, errors, and provider-specific continuation state. Accumulate tool calls with stable IDs and execute them only when complete. Keep text-JSON compatibility as an explicit adapter for models that require it. Do not interpret arbitrary instructional JSON in an answer as an executable action.

**Acceptance:** Native structured calls, split streamed arguments, multiple calls, ordinary JSON examples, text-only responses, and interrupted streams all work across adapters.

### 2. Budget the complete request at every model call

**Observed:** `backend/routers/chat.py:1202` budgets system/history before adding the current message, retrieval, MCP results, and native tool schemas. Later tool rounds append further content without a fresh budget. Pinned memories and persona text can exceed the system budget; the latest history message is retained even when it cannot fit. `estimate_tokens` uses characters divided by four.

**Change:** Use one context assembler for all calls. Budget instructions, current request, attachment excerpts, memory, summary, history, tool schemas/results, provider framing, and response reserve together. Recompute after each tool result. Use model-aware token counting when available and conservative estimates otherwise. Bound oversized pinned content and attachments, retaining references to full originals. Preserve complete message/tool exchanges when trimming.

**Acceptance:** Capture actual assembled requests in tests; large code pastes, many pinned memories, and long tool outputs stay within a defined budget. Surface omitted material to the user when it matters.

### 3. Summarize what actually leaves context

**Observed:** `_summarize_aged_out_history` at `backend/routers/chat.py:508` uses message count, while history also drops by tokens. Under 30 messages, long exchanges can disappear from the prompt without being summarized. Summary input truncates every message to 800 characters. Background updates have no per-conversation serialization/version check.

**Change:** Summarize actual eviction boundaries. Retain structured decisions, constraints, open work, artifact IDs, and evidence references. Chunk large source messages instead of silently clipping critical endings. Store the covered message range and update summaries monotonically under concurrent turns. Keep searchable raw history for recovery.

**Acceptance:** An early constraint buried after character 800 remains recoverable after a long conversation or oversized upload. Concurrent summaries cannot overwrite newer coverage with older coverage.

### 4. Preserve confirmed memory when proposing changes

**Observed:** `_process_memories` at `backend/routers/chat.py:619` overwrites an existing title, replaces its content, and marks it provisional. It skips conflict checking for that path. The original confirmed value is lost. Title matching is global.

**Change:** Use stable memory IDs, project scope, and revisions. A proposed revision should not replace the current confirmed version until accepted. Record source message/tool, author, timestamps, verification status, and supersession. Use semantic deduplication as a suggestion rather than treating similar text as the same fact automatically.

**Acceptance:** A mistaken model update leaves the confirmed value intact; the user can inspect a diff, accept, reject, or undo it. Two projects can have the same memory title.

### 5. Apply memory trust and expiry consistently

**Observed:** `_call_native_tool` at `backend/routers/chat.py:878` returns only title/content for `search_memory`. It omits provisional status, expiry/volatility, conflicts, timestamps, and project information, and does not apply the automatic retrieval expiry filter.

**Change:** Route automatic and explicit memory retrieval through one service. Include provenance/trust metadata and active scope in both. Make conflict candidates visible together. Treat saved model claims as evidence with a trust level, not authoritative instructions.

**Acceptance:** Asking the model to search deeper cannot revive expired task notes or turn provisional claims into apparently confirmed facts.

### 6. Make knowledge replacement and deletion reliable

**Observed:** `backend/services/knowledge.py:288` marks old content superseded and attempts vector deletion before uploading the replacement vectors. Failed old-vector cleanup is ignored. Search reads Qdrant payloads without checking SQLite's active-source state. Deletion likewise commits the SQLite deletion even when vector cleanup fails.

**Change:** Stage new versions, validate indexing, then activate them. Maintain durable retry jobs for index writes/deletes. Filter results against active source/version state so failed cleanup cannot resurrect removed content. Preserve the previous active version if replacement indexing fails.

**Acceptance:** Simulated Qdrant failures during replace/delete neither erase the last good source nor expose deleted/superseded content.

### 7. Make failures distinguishable from empty evidence

**Observed:** Many retrieval and MCP exceptions return empty lists/strings. `_gate_matches` also returns false on errors. `memory_index.index_memory` calls `_ensure_collection` outside the surrounding failure-catching blocks, so some Qdrant failures can escape after the SQLite write has already committed.

**Change:** Return typed outcomes such as unavailable, timed out, no matches, invalid call, denied, and verified success. Keep text chat usable while explaining missing capabilities. Queue failed indexing instead of making memory saves appear to fail after they committed.

**Acceptance:** The model/user can distinguish “no matching memory” from “memory search is offline”; repair reindexes pending rows without duplicate memories.

## Priority 1: support different models and sustained tasks

### 8. Introduce provider adapters and model capability profiles

**Observed:** `backend/routers/servers.py` registers and pings non-Ollama endpoints, but both chat routes call the Ollama wrapper. The frontend chat payload sends host/port, not server type or provider identity. Registered authentication is not passed through that path. Tool routing uses a separately configured local model; embedding services also default to local Ollama.

**Change:** Introduce a provider interface for completion, streaming, model metadata, authentication, and optional embeddings. Pass a server ID from the UI and resolve credentials on the backend. Support full base URLs and provider-specific adapters. Separate conversation, tool execution, routing, summary, and embedding model roles. Keep explicit fallbacks for text-only models.

**Acceptance:** The same app workflow passes against an Ollama model and an independently configured compatible server. Unsupported capabilities produce clear degradation, not broken calls. Health checks distinguish authentication failure from usable service; current `status_code < 500` treats 401/404 as online.

### 9. Carry task state into tool execution

**Observed:** `gather_context_for_message` at `backend/services/mcp_tool_agent.py:213` receives only the latest message. Its gate and tool loop do not receive conversation history, memory, or selected project. Each matching server runs a separate loop, then returns a prose summary to the main model.

**Change:** Pass a compact task envelope: objective, relevant prior turns, constraints, project, selected objects, artifact references, and prior verified results. Prefer a shared orchestration loop capable of using multiple tool families. Preserve raw structured evidence alongside summaries.

**Acceptance:** After inspecting a timeline, “apply that to the second clip” identifies the intended clip. Follow-ups do not depend on the user restating the project every turn.

### 10. Add durable task execution state

**Observed:** Chat persists user/assistant text; tool-loop state lives in local message lists. There is no durable execution record in this path that supports resuming an interrupted multi-step task.

**Change:** Store run/step IDs, status, tool arguments/results, approval decisions, artifact IDs, retries, and verification outcomes. Add explicit completion criteria. Checkpoint after each completed action and resume from verified state. Use idempotency protections for writes and publishing.

**Acceptance:** A disconnect/restart cannot silently rerun a completed write. The UI shows completed work separately from pending or uncertain work.

### 11. Correct tool-result handling and verification

**Observed:** `_result_to_text` discards images, audio, resource links, and structured content. MCP results with `isError` are recorded as success if the HTTP/RPC call itself succeeds. Repeat-call suppression rejects identical reads throughout a loop, even after a mutation could have changed state. Verification is encouraged by the tool prompt, not enforced as an execution contract.

**Change:** Preserve typed results and explicit error state. Feed images to capable models or an optional vision specialist. Invalidate read-result reuse after relevant writes. Define postconditions for consequential operations; return verified, failed, or unverified outcomes.

**Acceptance:** “Read timeline → edit → read timeline” works. A returned screenshot can be inspected. An MCP `isError` cannot increment the successful-action count.

### 12. Improve tool discovery, validation, and policy

**Observed:** Tool selection ranks lexical overlap and retains at most 24 schemas. Routing adds a model call for each gate, sequentially. Validation only checks top-level required fields/basic types. Permissions are inferred mainly from name prefixes. `_mcp_post` is a minimal per-request HTTP/SSE wrapper.

**Change:** Use task-aware tool discovery with prerequisite/read/verification tools preserved. Cache catalogs and support pagination/changes. Validate full schemas, including nested values and enums. Maintain locally controlled, server-qualified tool policies; use server annotations as hints, not authority. For broader MCP compatibility, use a protocol-aware client with negotiated capabilities, appropriate session lifecycle, timeouts, and cancellation.

**Acceptance:** Similar tool names on different servers stay distinct; required verification tools remain available; malformed nested arguments fail before execution. A long-running operation reports a job ID or progress instead of losing its result at the proxy timeout.

### 13. Unify the HTTP and WebSocket runtimes

**Observed:** `/complete` at `backend/routers/chat.py:1169` has much less behavior than WebSocket chat: no equivalent memory/retrieval/tool/summarization pipeline or conversation persistence.

**Change:** Put execution in a transport-independent service. HTTP, WebSocket, future voice, and automated workflows consume the same events and use the same memory/tool policies.

**Acceptance:** Equivalent requests see equivalent context and capabilities through both transports.

### 14. Replace prompt contradictions with live capabilities

**Observed:** Glyph's shipped system prompt describes its spreadsheet tool and also says “You have no real tools.” Several personas deny live access despite automatic knowledge/web injection. Native tools and memory are enabled by persona identity rather than a general capability policy. Central's prompt asserts extensive continuity that the runtime cannot always supply.

**Change:** Separate persona voice from factual capability descriptions. Generate capabilities from enabled tools, model support, and service health. Keep shared behavioral instructions concise and move domain procedures/examples into task-specific resources. Make memory access an explicit persona policy. Move memory-save instructions out of the conditional existing-memory section; central currently has its own duplicate instructions, but custom personas cannot depend on that.

**Acceptance:** Prompt checks find no contradictory tool claims. Small-context profiles retain task instructions and useful evidence before optional style examples.

## Priority 2: better memory, retrieval, and creative workflows

### 15. Make projects an actual context boundary

**Observed:** Project IDs exist in the schema, but automatic memory/recent-chat/knowledge retrieval does not filter on the active project. Chat.tsx does not send a project ID, and the knowledge learn request does not expose one. Auto-created memories are unscoped.

**Change:** Add an active project selector and scope retrieval to that project plus explicitly shared global preferences. Carry scope through chat, indexing, native searches, artifacts, and task state. Define deletion/reassignment semantics rather than retaining dangling project IDs.

**Acceptance:** Two projects with conflicting color palettes, filenames, or decisions cannot contaminate one another. Explicit cross-project search remains available.

### 16. Separate kinds of memory

**Proposal:** Keep distinct representations for user preferences, project facts/decisions, episodic work history, short-lived task state, and validated reusable procedures. Include effective dates and source references. Store “what happened” separately from “what to do next.” Avoid treating every conversational idea as a durable fact.

Use structured memory proposals or a dedicated save-memory operation, preserving a bounded fallback for models without native tools. Do not scrape arbitrary visible assistant XML as the sole persistence mechanism. Offer remember/forget/correct controls and revision history. Deleting a memory should explain whether its original conversation/source remains searchable.

### 17. Upgrade retrieval candidate generation

**Observed:** Knowledge search at `backend/services/knowledge.py:423` reranks only vector-selected candidates with term overlap. A perfect lexical match outside that pool cannot be recovered. Memory retrieval embeds only the latest message, whereas knowledge retrieval concatenates recent conversation text. Both treat service failure much like no match.

**Change:** Retrieve independently with dense vectors and lexical search, merge rankings, then optionally rerank a bounded set. Rewrite ambiguous follow-up queries from relevant task context. Add SQLite full-text fallback where practical. Filter by project, active version, trust, and expiry before selecting final evidence. Deduplicate overlapping chunks and balance source diversity.

**Acceptance:** Rare filenames, IDs, exact names, paraphrases, and “that earlier decision” all have measured recall. Evaluate a reranker before paying its latency cost on every turn.

### 18. Preserve document structure and embedding identity

**Observed:** Ordinary text chunks are approximately 1,200 characters with overlap. Element-aware PDF chunks already carry page/table metadata. Embedding model names and collections are fixed; collection existence checks do not validate that an existing index matches the embedding configuration.

**Change:** Extend structure-aware ingestion to headings, code boundaries, tables, and media timecodes. Store original content or a recoverable source reference. Track embedding model/version, dimensions, and text preprocessing in collection metadata. Rebuild into a separate index and activate it only after validation when changing embedding models, even when dimensions match.

**Acceptance:** A changed embedding model cannot silently mix incompatible vector spaces. Table rows retain headers; retrieved code retains its enclosing symbol.

### 19. Make web research citable

**Observed:** `_web_search` at `backend/routers/chat.py:680` returns titles and roughly 250-character snippets, dropping result URLs. It offers no native page-opening step in the shown chat toolset.

**Change:** Preserve URL, title, timestamp, publisher, and source ID. Add bounded page fetch/extraction and follow-up search. Require current claims to reference retrieved evidence, with explicit insufficient-evidence outcomes. Keep retrieved text separate from executable instructions.

**Acceptance:** The user can open supporting sources. Search snippets cannot masquerade as having read the full page.

### 20. Connect the assistant to actual studio work

**Observed:** The chat-native toolset is memory search, knowledge search, web search, and spreadsheet generation. The central MCP path adds gated servers; advertising GPU/media features in the system prompt does not itself give chat callable access to their application APIs.

**Proposal:** Expose selected existing studio operations through stable typed tools: inspect assets, generate an image/audio draft, transcribe, add captions, inspect render status, and retrieve outputs. Start with one complete workflow. Unify asset IDs and project metadata across pages. Add reusable, versioned procedures for operations such as preparing a captioned short, with input requirements and verifiable output checks.

**Acceptance:** “Make a captioned clip from this recording” produces an actual linked artifact and job state; the assistant can inspect duration/captions instead of merely giving instructions. Publishing remains separately governed by its action policy.

## Priority 3: observability, performance, and evaluation

### 21. Persist evidence and completion events

**Observed:** `context_used` is emitted before native tool execution, so later web/memory/knowledge calls are not included. Retrieved memory IDs are absent. UI context metadata lives in local action state and uses temporary message IDs. Final token completion can reach the client before the assistant message has been persisted.

**Change:** Emit durable run/message IDs, a saved-message completion event, and evidence events for every retrieval/tool call. Display sources, memory revisions, model/provider, truncated sections, verification state, and degraded services. Show routing decisions or concise execution summaries, not hidden reasoning traces.

**Acceptance:** Reloading the chat retains its evidence trail; the UI cannot fetch the completed message before that message exists.

### 22. Stop presenting similarity as confidence

**Observed:** Chat.tsx multiplies retrieval scores by 100 and labels them a percentage match. The knowledge score adds lexical overlap to vector similarity and can exceed 1. It is not a calibrated probability of correctness.

**Change:** Label it as a retrieval score or omit it from the normal UI. Show whether evidence supports the answer through actual citations and verification rather than an invented confidence percentage.

### 23. Add cancellation and structured message dispatch

**Observed:** The approval callback reads the next socket message directly; an unrelated message is consumed as a denial and lost. There is no chat cancellation event in the protocol. New Chat bounces the socket, which does not guarantee immediate cancellation of buffered model work or ongoing tools.

**Change:** Use a single socket receiver that dispatches turn, approval, cancel, and steering messages by IDs. Cancel generation and queued work explicitly; track active actions separately and report whether they can stop safely. Keep drafts and interrupted results recoverable.

**Acceptance:** Sending a correction during an approval does not lose text. Stop actually stops pending generation; already-completed actions remain recorded.

### 24. Coordinate all local inference with GPU work

**Observed:** Media GPU jobs use a shared queue. Ordinary chat, gate classifiers, summaries, conflict checks, and embeddings do not acquire that queue. Escalation merely checks queue depth, which does not reserve resources.

**Change:** Add resource-aware scheduling across inference and media work, with interactive/background priority, model residency policy, cancellation, and queue telemetry. Make context ceilings hardware/model profiles instead of relying on one machine's constants. Cache reusable embeddings, metadata, and routing where safe.

**Acceptance:** Running image generation does not cause background summaries to trigger unexpected model loading or obscure out-of-memory failures. Measure time to first response and completed-task latency.

### 25. Evaluate behavior across models, including failures

**Observed:** Live behavior tests exist, but use fixed model choices and a small case set. Comments document removing difficult/flaky cases. Prometheus tracks calls, tokens, latency, and failures but not task correctness or evidence quality.

**Change:** Keep deterministic unit/contract tests, and add a versioned behavioral benchmark across provider/model profiles. Retain difficult cases as repeated statistical evaluations or known failures rather than deleting them. Measure task completion, retrieval recall, memory correctness, unsupported claims, tool argument validity, verification rate, latency, and cost/resource use. Add user corrections as reviewed regression cases, not automatically trusted training data.

**Acceptance:** A model/runtime change produces a comparison report over repeated trials, including failure categories. A green unit suite is not treated as proof that the assistant completed real tasks correctly.

## Suggested implementation order

1. Establish a small behavioral baseline and add regression cases for the confirmed stream, budget, summary, memory-revision, and index-lifecycle defects.
2. Implement a shared runtime with normalized provider events and complete request budgeting. Preserve current working UI contracts during migration.
3. Introduce memory revisions, consistent retrieval policies, durable index retries, and actual project scoping.
4. Add persistent execution records, context-aware tool use, typed results, and outcome verification.
5. Improve retrieval and web evidence; then connect one end-to-end studio workflow and measure it.
6. Tune model roles, context profiles, reranking, and optional fallback models using the benchmark results.

Do not start by increasing every context window, installing more agents, or fine-tuning on raw conversations. None repairs dropped tool calls, incomplete evidence, or destructive memory updates. Fine-tuning can be evaluated later for a stable specialized behavior using curated examples; fresh project facts belong in the memory/retrieval system.

## External protocol references checked

- [Ollama streaming](https://docs.ollama.com/capabilities/streaming): streaming includes content and structured tool-call fields that callers must accumulate; confirms why preserving only content is insufficient.
- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools): typed/structured tool results, error signaling, pagination, and annotations; annotations require trust assessment.
- [Qdrant hybrid queries](https://qdrant.tech/documentation/search/hybrid-queries/): independent prefetches and rank fusion support the proposed retrieval improvement.
