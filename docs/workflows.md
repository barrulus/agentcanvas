# Workflow Orchestration

AgentCanvas supports building multi-agent workflows where input flows through a chain of agents, each performing a specific task. This document covers how to build, configure, and run workflows.

![Collapsed workflow group](../images/chromium-browser_2026-04-05_18-22-43.png)

## Concepts

### Input Cards

Input cards are workflow entry points. They don't have an LLM provider -- they're pure routing nodes that send content to downstream agents.

**Three source modes:**

| Mode | Description | Usage |
|------|-------------|-------|
| **Chat** | Manual text input box | Type a message, click Send. Content routes to all connected agents. |
| **Webhook** | HTTP POST endpoint | External systems POST JSON to `/api/input-cards/{id}/webhook`. The payload should include a `content`, `text`, or `data` field. |
| **File Watcher** | Polls a file/directory | Watches a path every 2 seconds. When the file changes, its content is sent downstream. For directories, the most recently modified file is used. |

**Creating an input card:** Click "+ Input Card" in the toolbar and select the source mode. For file watchers, you'll be prompted for the path.

### Agent Cards

Agent cards run LLM providers (Claude Code or Ollama). In workflows, agents are typically created without an initial message -- they wait for input from upstream connections.

**Creating a workflow agent:** Click "+ New Agent", configure provider/model/system prompt, and click "Create" (leave the initial message empty). The agent will sit in `idle` status until it receives routed input.

**Downstream locking:** When an agent has any incoming connection, its chat input is hidden and replaced with "Receives input from upstream connection". This prevents manual interference with the workflow.

### View Cards

View cards display output. Connect an agent to a view card to capture its final response. View cards render Markdown.

### Connections

Draw a connection by clicking a port (cyan dot) on one card and dragging to another card's port. Connections define the flow of data between cards.

**Connection properties** (right-click a connection to edit):

| Property | Description | Example |
|----------|-------------|---------|
| **Condition** | Filter: only route if output matches | `contains:error`, `regex:SUCCESS\|OK` |
| **Output Schema** | JSON Schema validation before routing | `{"type": "object", "required": ["summary"]}` |
| **Transform** | Reshape output before sending | `{{output.summary}}`, `Summarize: {{output}}` |

## Named Routing

For decision/router agents that need to direct output to a specific downstream agent, use **named routing tags**:

```
{{route:AgentName}}
```

### How it works

1. The router agent includes `{{route:Animals}}` in its output
2. The routing system extracts the tag and matches it (case-insensitive) against downstream agent names
3. Only the matching agent(s) receive the output
4. The route tag is stripped from the forwarded content
5. If the output is empty after stripping (i.e., only contained route tags), the original user input is forwarded instead

### Example: Decision Router

**Setup:**
```
[Input Card] --> [Decision Maker] --> [Animals Agent]
                                 --> [Plant Agent]
                                 --> [Summarizer] --> [View Card]
```

**Decision Maker system prompt:**
```
You are a classifier. Based on the input, determine if it's about animals or plants.
Respond ONLY with {{route:Animals}} or {{route:Plant}} -- nothing else.
```

**Result:** When "Tell me about dolphins" is entered, the Decision Maker outputs `{{route:Animals}}`, and only the Animals agent receives the query. The Plant agent stays idle.

### Multiple route tags

You can include multiple route tags to fan out to specific agents:
```
{{route:Animals}} {{route:Summarizer}}
```

## Workflow Lifecycle

### Message clearing

When an input card sends new content, **all downstream agents are reset** before routing:
- Agent messages are cleared
- Status resets to `idle`
- Cost and token counts reset to zero
- View card content is emptied

This ensures each input starts with a clean slate.

### Stateless execution

Each agent invocation is independent -- there is no conversation history carried between messages. This is by design for workflow pipelines where each input should be processed fresh.

### Chaining

When an agent completes, its output is automatically routed to downstream connections. This creates chains:

```
Input --> Agent A --> Agent B --> View Card
```

Agent A completes, its output routes to Agent B. When Agent B completes, its output routes to the View Card. The routing system has a depth limit of 10 to prevent infinite loops.

## Card Collapse

Double-click any card's header to collapse it to a compact BPMN-style chip showing just the status dot, name, and model. Double-click again to expand.

![Expanded workflow](../images/chromium-browser_2026-04-05_18-23-32.png)

Collapsed state persists in the layout. Connection lines automatically recompute their positions based on the collapsed dimensions.

## Groups

Select multiple cards with **Ctrl+click**, then click the "Group (N)" button in the toolbar.

Groups can be:
- **Collapsed** -- hides all member cards, shows a single compact box. Internal connections are hidden; external connections reroute to the group box.
- **Expanded** -- shows a dashed bounding box around members. Double-click the group header to rename.
- **Moved** -- drag the group header to move all members together.
- **Deleted** -- click the "x" on the group header (ungroups, doesn't delete cards).

## Webhook Integration

Webhook input cards expose an HTTP endpoint for external systems:

```bash
# Get the webhook URL (shown on the card)
POST http://localhost:8325/api/input-cards/{card_id}/webhook

# Send content
curl -X POST http://localhost:8325/api/input-cards/{card_id}/webhook \
  -H "Content-Type: application/json" \
  -d '{"content": "Tell me about elephants"}'
```

The payload should include one of: `content`, `text`, or `data`. Objects/arrays are JSON-serialized.

## File Watcher

File watcher input cards poll a file or directory every 2 seconds:

- **File:** Triggers when the file's modification time changes. The entire file content is sent downstream.
- **Directory:** Triggers when any file in the directory is modified. The most recently modified file's content is sent.

File watchers start automatically when the input card is created and survive server restarts.
