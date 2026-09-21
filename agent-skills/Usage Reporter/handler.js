module.exports.runtime = {
  handler: async function ({ timeframe }) {
    const callerId = `${this.config.name}-v${this.config.version}`;

    const apiKey = this.runtimeArgs?.ANYTHINGLLM_API_KEY;
    const baseUrl = (this.runtimeArgs?.ANYTHINGLLM_URL || 'http://localhost:3001').replace(/\/$/, '');

    if (!apiKey) {
      return [
        '╔══════════════════════════════════════════════════════════╗',
        '║              ⚠  CONFIGURATION REQUIRED                   ║',
        '╚══════════════════════════════════════════════════════════╝',
        '',
        '  API key not configured.',
        '  Go to: Settings → Agent Skills → Usage Reporter',
        '  Then enter your AnythingLLM API key.',
        '',
        '  To generate a key: Settings → API Keys → New API Key'
      ].join('\n');
    }

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    const now = new Date();

    try {
      this.introspect(`${callerId} — building report for timeframe: ${timeframe}`);

      // Parallel fetch: system info, workspaces, vector count, documents
      const [sysRes, wsRes, vecRes, docRes] = await Promise.all([
        fetch(`${baseUrl}/api/v1/system`, { headers }),
        fetch(`${baseUrl}/api/v1/workspaces`, { headers }),
        fetch(`${baseUrl}/api/v1/system/vector-count`, { headers }),
        fetch(`${baseUrl}/api/v1/documents`, { headers })
      ]);

      const sysData  = sysRes.ok  ? await sysRes.json()  : {};
      const wsData   = wsRes.ok   ? await wsRes.json()   : {};
      const vecData  = vecRes.ok  ? await vecRes.json()  : {};
      const docData  = docRes.ok  ? await docRes.json()  : {};

      const settings      = sysData.settings || {};
      const allWorkspaces = wsData.workspaces || [];

      const vectorCount = vecData.vectorCount ?? vecData.count ?? vecData.total ?? 0;

      // Document count — handle varied response shapes
      let docCount = 0;
      try {
        const items = docData.localFiles?.items || docData.items || [];
        for (const folder of items) {
          docCount += (folder.items?.length || 0);
        }
      } catch {}

      const totalThreads = allWorkspaces.reduce((acc, ws) => acc + (ws.threads?.length || 0), 0);

      // System mode — no chat fetching needed
      if (timeframe === 'system') {
        return buildSystemReport(settings, allWorkspaces, totalThreads, vectorCount, docCount, now);
      }

      // Timeframe setup
      let lookbackMs  = 24 * 60 * 60 * 1000;
      let periodLabel = 'Last 24 Hours';
      if (timeframe === '1h') { lookbackMs = 60 * 60 * 1000;            periodLabel = 'Last Hour';    }
      if (timeframe === '7d') { lookbackMs = 7 * 24 * 60 * 60 * 1000;  periodLabel = 'Last 7 Days';  }
      const cutoff = new Date(now.getTime() - lookbackMs);

      // Paginate admin chat endpoint — filter client-side, stop when we pass the cutoff
      let offset   = 0;
      let allChats = [];
      let done     = false;

      while (!done) {
        this.introspect(`Fetching message batch (offset ${offset})...`);

        const chatRes = await fetch(`${baseUrl}/api/v1/admin/workspace-chats`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ offset, limit: 100 })
        });

        if (!chatRes.ok) throw new Error(`Chat API returned ${chatRes.status}`);

        const data  = await chatRes.json();
        const batch = data.chats || [];
        const recent = batch.filter(c => new Date(c.createdAt) >= cutoff);
        allChats.push(...recent);

        // Stop if last page OR we've hit records older than the cutoff
        if (batch.length < 100 || recent.length < batch.length) done = true;
        else offset += 100;
      }

      // Seed stats for ALL workspaces so zeros appear in the report
      const wsStats = {};
      for (const ws of allWorkspaces) {
        wsStats[ws.name] = {
          name:          ws.name,
          messages:      0,
          promptTokens:  0,
          completionTokens: 0,
          totalTokens:   0,
          totalDuration: 0,
          durationCount: 0,
          models:        new Set()
        };
      }

      let totalMessages         = 0;
      let totalPromptTokens     = 0;
      let totalCompletionTokens = 0;
      let totalTokens           = 0;
      let totalDuration         = 0;
      let durationCount         = 0;
      const globalModels        = new Set();

      for (const chat of allChats) {
        const wsName = chat.workspace?.name || 'Unknown';

        if (!wsStats[wsName]) {
          wsStats[wsName] = {
            name: wsName, messages: 0,
            promptTokens: 0, completionTokens: 0, totalTokens: 0,
            totalDuration: 0, durationCount: 0, models: new Set()
          };
        }

        const ws = wsStats[wsName];
        ws.messages++;
        totalMessages++;

        // Metrics live inside the response JSON string
        let metrics = null;
        if (chat.response) {
          try {
            const parsed = typeof chat.response === 'string'
              ? JSON.parse(chat.response)
              : chat.response;
            metrics = parsed.metrics || null;
          } catch {}
        }

        if (metrics) {
          const pt = metrics.prompt_tokens     || 0;
          const ct = metrics.completion_tokens || 0;
          ws.promptTokens      += pt;
          ws.completionTokens  += ct;
          ws.totalTokens       += (pt + ct);
          totalPromptTokens    += pt;
          totalCompletionTokens += ct;
          totalTokens          += (pt + ct);

          if (metrics.duration) {
            ws.totalDuration  += metrics.duration;
            ws.durationCount++;
            totalDuration     += metrics.duration;
            durationCount++;
          }
          if (metrics.model) {
            ws.models.add(metrics.model);
            globalModels.add(metrics.model);
          }
        }
      }

      return buildUsageReport({
        periodLabel, now, allWorkspaces, wsStats,
        totalMessages, totalPromptTokens, totalCompletionTokens, totalTokens,
        totalDuration, durationCount, globalModels, vectorCount, docCount
      });

    } catch (e) {
      this.logger(`${callerId} failed`, e.message);
      return [
        '╔══════════════════════════════════════════════════════════╗',
        '║                      ✗  ERROR                            ║',
        '╚══════════════════════════════════════════════════════════╝',
        '',
        `  ${e.message}`,
        '',
        '  Check your API key and ANYTHINGLLM_URL in skill settings.'
      ].join('\n');
    }
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad(val, len, right = false) {
  const s = String(val);
  if (s.length >= len) return s.substring(0, len);
  return right ? s.padStart(len) : s.padEnd(len);
}

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

function pct(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}

// ─── System Report ────────────────────────────────────────────────────────────

function buildSystemReport(settings, workspaces, totalThreads, vectorCount, docCount, now) {
  const W = 60;
  const line = '═'.repeat(W - 2);
  const blank = `║${' '.repeat(W - 2)}║`;

  function row(label, value) {
    const l = pad(label, 20);
    const v = pad(String(value), W - 24);
    return `║  ${l}  ${v}║`;
  }

  return [
    `╔${line}╗`,
    `║${pad('  ANYTHINGLLM — SYSTEM CONFIGURATION', W - 2)}║`,
    `║  Generated: ${pad(now.toUTCString(), W - 15)}║`,
    `╠${line}╣`,
    `║  ${'LLM & INFERENCE'.padEnd(W - 5)}║`,
    `╠${line}╣`,
    row('Provider',        settings.LLMProvider || 'unknown'),
    row('Active Model',    (settings.LMStudioModelPref || settings.LLMModel || 'unknown').substring(0, W - 24)),
    row('LM Studio URL',   settings.LMStudioBasePath || 'n/a'),
    row('Embedding Engine',settings.EmbeddingEngine || 'unknown'),
    row('Embedding Model', (settings.EmbeddingModelPref || 'unknown').substring(0, W - 24)),
    row('Whisper',         settings.WhisperProvider || 'unknown'),
    row('TTS Provider',    settings.TextToSpeechProvider || 'unknown'),
    `╠${line}╣`,
    `║  ${'INSTANCE'.padEnd(W - 5)}║`,
    `╠${line}╣`,
    row('Multi-User Mode', settings.MultiUserMode         ? 'Enabled'  : 'Disabled'),
    row('Memory',          settings.MemoryEnabled         ? 'Enabled'  : 'Disabled'),
    row('Auto-Extraction', settings.MemoryAutoExtraction  ? 'Enabled'  : 'Disabled'),
    row('Has Embeddings',  settings.HasExistingEmbeddings ? 'Yes'      : 'No'),
    row('Agent Max Tools', settings.AgentSkillMaxToolCalls ?? 'unknown'),
    row('Reranker',        settings.AgentSkillRerankerEnabled ? `Enabled (top ${settings.AgentSkillRerankerTopN})` : 'Disabled'),
    row('Telemetry',       settings.DisableTelemetry === 'true' ? 'Disabled' : 'Enabled'),
    `╠${line}╣`,
    `║  ${'KNOWLEDGE BASE'.padEnd(W - 5)}║`,
    `╠${line}╣`,
    row('Workspaces',      workspaces.length),
    row('Total Threads',   totalThreads),
    row('Documents',       docCount || 'n/a'),
    row('Vectors Stored',  fmt(vectorCount)),
    `╚${line}╝`,
    '',
    '  * Deleted threads and purged sessions are not counted.',
    '  * Thread count reflects currently visible threads only.'
  ].join('\n');
}

// ─── Usage Report ─────────────────────────────────────────────────────────────

function buildUsageReport({
  periodLabel, now, allWorkspaces, wsStats,
  totalMessages, totalPromptTokens, totalCompletionTokens, totalTokens,
  totalDuration, durationCount, globalModels, vectorCount, docCount
}) {
  const W       = 60;
  const line    = '═'.repeat(W - 2);
  const avgTok  = totalMessages  ? Math.round(totalTokens / totalMessages) : 0;
  const avgResp = durationCount  ? (totalDuration / durationCount).toFixed(2) : 'n/a';
  const inPct   = pct(totalPromptTokens, totalTokens);
  const outPct  = pct(totalCompletionTokens, totalTokens);

  function row(label, value) {
    const l = pad(label, 22);
    const v = pad(String(value), W - 26);
    return `║  ${l}  ${v}║`;
  }

  const lines = [
    `╔${line}╗`,
    `║${pad(`  ANYTHINGLLM USAGE REPORT — ${periodLabel.toUpperCase()}`, W - 2)}║`,
    `║  Generated: ${pad(now.toUTCString(), W - 15)}║`,
    `╠${line}╣`,
    `║  ${'ACTIVITY SUMMARY'.padEnd(W - 5)}║`,
    `╠${line}╣`,
    row('Total Messages',    fmt(totalMessages)),
    row('Total Tokens',      fmt(totalTokens)),
    row('  └ Prompt',        `${fmt(totalPromptTokens)} (${inPct}%)`),
    row('  └ Completion',    `${fmt(totalCompletionTokens)} (${outPct}%)`),
    row('Avg Tokens/Msg',    fmt(avgTok)),
    row('Avg Response Time', avgResp === 'n/a' ? 'n/a' : `${avgResp}s`),
    `╠${line}╣`,
    `║  ${'MODELS ACTIVE THIS PERIOD'.padEnd(W - 5)}║`,
    `╠${line}╣`,
  ];

  if (globalModels.size === 0) {
    lines.push(`║  ${'No model data in this period'.padEnd(W - 5)}║`);
  } else {
    for (const m of globalModels) {
      lines.push(`║  • ${pad(m.substring(0, W - 7), W - 7)}║`);
    }
  }

  // Workspace table
  lines.push(`╠${'═'.repeat(28)}╦${'═'.repeat(8)}╦${'═'.repeat(11)}╦${'═'.repeat(9)}╣`);
  lines.push(`║  ${'Workspace'.padEnd(26)}║${'  Msgs'.padEnd(8)}║${'   Tokens'.padEnd(11)}║${'  Avg/Msg'.padEnd(9)}║`);
  lines.push(`╠${'═'.repeat(28)}╬${'═'.repeat(8)}╬${'═'.repeat(11)}╬${'═'.repeat(9)}╣`);

  const sorted = Object.values(wsStats).sort((a, b) => b.messages - a.messages);
  for (const ws of sorted) {
    const name  = pad(ws.name.substring(0, 26), 26);
    const msgs  = pad(fmt(ws.messages), 6, true);
    const toks  = pad(fmt(ws.totalTokens), 9, true);
    const avg   = ws.messages ? pad(fmt(Math.round(ws.totalTokens / ws.messages)), 7, true) : pad('—', 7, true);
    lines.push(`║  ${name}║${msgs}  ║${toks}  ║${avg}  ║`);
  }

  lines.push(`╠${'═'.repeat(28)}╩${'═'.repeat(8)}╩${'═'.repeat(11)}╩${'═'.repeat(9)}╣`);
  lines.push(`║  ${'KNOWLEDGE BASE'.padEnd(W - 5)}║`);
  lines.push(`╠${line}╣`);
  lines.push(row('Total Workspaces',  allWorkspaces.length));
  lines.push(row('Vectors Stored',    fmt(vectorCount)));
  lines.push(row('Documents',         docCount || 'n/a'));
  lines.push(`╚${line}╝`);
  lines.push('');
  lines.push('  * Message counts reflect committed DB records only.');
  lines.push('  * Deleted threads and purged sessions are excluded from this report.');

  return lines.join('\n');
}

