"""Built-in prompt templates shipped with AgentCanvas."""

BUILTIN_TEMPLATES = [
    {
        "id": "builtin-code-reviewer",
        "name": "Code Reviewer",
        "slug": "code-review",
        "description": "Review code for bugs, security issues, and style",
        "system_prompt": (
            "You are a thorough code reviewer. Analyze code for bugs, security vulnerabilities, "
            "performance issues, and style problems. Return findings as a structured list with "
            "severity levels (critical, warning, info)."
        ),
        "prompt": "Review the following code or files:\n\n{{code_or_path}}",
        "fields": [
            {
                "name": "code_or_path",
                "label": "Code or file path",
                "type": "textarea",
                "placeholder": "Paste code or provide a file path to review",
                "required": True,
            },
        ],
        "tags": ["code", "review", "quality"],
        "is_builtin": True,
    },
    {
        "id": "builtin-data-extractor",
        "name": "Data Extractor",
        "slug": "extract-data",
        "description": "Extract structured data from text, files, or URLs",
        "system_prompt": (
            "You are a data extraction specialist. Parse the input and extract structured data "
            "in the requested format. Use tools like jq, grep, awk, or python as needed. "
            "Always output clean, well-formatted results."
        ),
        "prompt": "Extract data from the following source and output as {{format}}:\n\n{{source}}",
        "fields": [
            {
                "name": "source",
                "label": "Data source",
                "type": "textarea",
                "placeholder": "Text, file path, or description of data to extract from",
                "required": True,
            },
            {
                "name": "format",
                "label": "Output format",
                "type": "select",
                "options": ["JSON", "CSV", "Markdown table", "bullet list"],
                "default": "JSON",
                "required": True,
            },
        ],
        "tags": ["data", "extraction", "parsing"],
        "is_builtin": True,
    },
    {
        "id": "builtin-summarizer",
        "name": "Summarizer",
        "slug": "summarize",
        "description": "Summarize text, files, or code in a chosen style",
        "system_prompt": (
            "You are a concise summarizer. Distill the input to its essential points. "
            "Preserve key facts, decisions, and action items. Omit filler and repetition."
        ),
        "prompt": "Summarize the following as {{style}}:\n\n{{content}}",
        "fields": [
            {
                "name": "content",
                "label": "Content to summarize",
                "type": "textarea",
                "placeholder": "Paste text, provide a file path, or describe what to summarize",
                "required": True,
            },
            {
                "name": "style",
                "label": "Summary style",
                "type": "select",
                "options": ["bullet points", "one paragraph", "TL;DR (1-2 sentences)", "executive summary"],
                "default": "bullet points",
                "required": True,
            },
        ],
        "tags": ["summary", "distill"],
        "is_builtin": True,
    },
    {
        "id": "builtin-file-processor",
        "name": "File Processor",
        "slug": "process-files",
        "description": "Process files in a directory with custom instructions",
        "system_prompt": (
            "You are a file processing agent. Use shell tools (find, grep, sed, awk, jq, python) "
            "to discover and process files as instructed. Report results clearly."
        ),
        "prompt": "Process files in {{directory}} with these instructions:\n\n{{instructions}}",
        "fields": [
            {
                "name": "directory",
                "label": "Directory path",
                "type": "text",
                "placeholder": "/path/to/files",
                "required": True,
            },
            {
                "name": "instructions",
                "label": "Processing instructions",
                "type": "textarea",
                "placeholder": "e.g. Find all JSON files, extract the 'name' field, and compile into a summary",
                "required": True,
            },
        ],
        "tags": ["files", "processing", "automation"],
        "is_builtin": True,
    },
]
