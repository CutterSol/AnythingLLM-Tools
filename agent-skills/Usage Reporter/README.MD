# Usage Reporter

An agent skill for [AnythingLLM](https://anythingllm.com) that provides detailed usage statistics and system configuration for your instance — across all workspaces, with no external dependencies.

## Features

- **Message counts** by workspace and timeframe
- **Token usage** — prompt vs. completion breakdown with ratios
- **Model tracking** — which models were active and where
- **Average response times** per reporting period
- **System configuration** — LLM provider, embedding engine, memory settings, agent config
- **Knowledge base stats** — workspace count, document count, vector count
- **All workspaces shown** — including zero-activity workspaces for the period
- **Pre-formatted ASCII report** output — no reformatting needed

## Requirements

- AnythingLLM Docker or self-hosted instance (v1.2.2+)
- An API key from your instance (Settings → API Keys)
- Node.js 18+ (included in all AnythingLLM Docker images)

> **Note:** This skill is not compatible with AnythingLLM Cloud, which does not support custom agent skills.

## Setup

1. Install via the AnythingLLM Community Hub import ID, or copy the skill folder manually to:
   ~~~
   <your-storage-dir>/plugins/agent-skills/usage-reporter/
   ~~~

2. Restart your AnythingLLM instance:
   ~~~bash
   docker restart anythingllm
   ~~~

3. Go to **Settings → Agent Skills → Usage Reporter** and enter:
   - **API Key** — generate one at Settings → API Keys → New API Key
   - **Instance URL** — leave as `http://localhost:3001` for standard local installs

4. The skill activates automatically. Use it via `@agent` in any workspace.

## Usage

Ask your agent in natural language:

~~~
@agent show me my usage stats for the last 24 hours
@agent give me a full report for the past week
@agent show my system configuration
@agent how many tokens have I used today?
@agent what models have I been using?
~~~

## Timeframe Options

| Parameter | Description |
|-----------|-------------|
| `1h`      | Last hour |
| `24h`     | Last 24 hours |
| `7d`      | Last 7 days |
| `system`  | Instance configuration and model info |

## Example Output

~~~
╔══════════════════════════════════════════════════════════╗
║      ANYTHINGLLM USAGE REPORT — LAST 24 HOURS            ║
║  Generated: Sat, 19 Jul 2026 02:47:00 GMT                ║
╠══════════════════════════════════════════════════════════╣
║  ACTIVITY SUMMARY                                        ║
╠══════════════════════════════════════════════════════════╣
║  Total Messages        20                                ║
║  Total Tokens          221,491                           ║
║    └ Prompt            215,957 (98%)                     ║
║    └ Completion        5,534 (2%)                        ║
║  Avg Tokens/Msg        11,075                            ║
║  Avg Response Time     4.42s                             ║
╠══════════════════════════════════════════════════════════╣
║  MODELS ACTIVE THIS PERIOD                               ║
╠══════════════════════════════════════════════════════════╣
║  • qwen3.6-35b-a3b-abliterated-max-i1                    ║
║  • gemini-flash-lite-latest                              ║
╠════════════════════════╦════════╦═══════════╦════════════╣
║  Workspace             ║  Msgs  ║  Tokens   ║  Avg/Msg   ║
╠════════════════════════╬════════╬═══════════╬════════════╣
║  Gemini                ║    14  ║   178,960  ║    12,783  ║
║  Business Manager      ║     6  ║    42,531  ║     7,089  ║
║  Local LLM Infra       ║     0  ║         0  ║         —  ║
║  (+ 7 more workspaces) ║     0  ║         0  ║         —  ║
╠════════════════════════╩════════╩═══════════╩════════════╣
║  KNOWLEDGE BASE                                          ║
╠══════════════════════════════════════════════════════════╣
║  Total Workspaces      10                                ║
║  Vectors Stored        169                               ║
║  Documents             4                                 ║
╚══════════════════════════════════════════════════════════╝

  * Message counts reflect committed DB records only.
  * Deleted threads and purged sessions are excluded.
~~~

## Data Notes

- **Messages** are individual prompt/response pairs, not threads. One thread contains multiple messages.
- **Deleted threads** and sessions purged before the report window are not included.
- **Token data** is sourced from the metrics embedded in each chat record. Chats from providers that do not report token counts will not contribute to token totals.
- The `system` timeframe makes no chat API calls — it is always fast regardless of history size.

## Author

**SaulCutter** — Allied Computer Consulting  
IT Infrastructure, Security & AI Consulting for SMBs

## License

MIT

