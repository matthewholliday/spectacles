import * as nodefs from 'fs/promises';
import * as nodepath from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { getWorkspaceRootUri, resolveLayoutUri, pathExists } from './layout';
import { getOutputChannel } from './runPrompt';

interface BundleMetadata {
	spec_version: string;
	name: string;
	id: string;
	status: string;
	description?: string;
	version?: string;
	timestamps?: { created: string; updated: string };
}

interface BundleData {
	metadata: BundleMetadata;
}

interface LogSession {
	sessionId: string;
	logFile: string;
	startedAt: string;
	status: 'active' | 'complete';
	endedAt?: string;
}

interface LogEntry {
	ts: string;
	event: 'session_start' | 'session_end' | 'agent_response' | 'agent_thought' | 'tool_use' | string;
	sessionId?: string;
	text?: string;
	tool?: string;
	label?: string;
}

interface PanelState {
	panel: vscode.WebviewPanel;
	uri: vscode.Uri;
	logWatcher: vscode.FileSystemWatcher | null;
	currentLogFile: string | null;
	currentLineCount: number;
}

const openPanels = new Map<string, PanelState>();

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function readFileText(uri: vscode.Uri): Promise<string | null> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

async function readBundleData(dirUri: vscode.Uri): Promise<BundleData | null> {
	const metadataUri = vscode.Uri.joinPath(dirUri, 'metadata.json');
	const metadataText = await readFileText(metadataUri);
	if (!metadataText) { return null; }

	let metadata: BundleMetadata;
	try {
		metadata = JSON.parse(metadataText);
	} catch {
		return null;
	}

	if (!metadata.spec_version || !metadata.name || !metadata.id || !metadata.status) {
		return null;
	}

	return { metadata };
}

// ---------------------------------------------------------------------------
// Log file helpers (written directly by the extension, not via hooks)
// ---------------------------------------------------------------------------

function nowIso(): string {
	return new Date().toISOString();
}

async function ensureLogsDir(root: vscode.Uri): Promise<string> {
	const dir = vscode.Uri.joinPath(root, '.spectacles', 'logs');
	await vscode.workspace.fs.createDirectory(dir);
	return nodepath.join(root.fsPath, '.spectacles', 'logs');
}

async function createLogSession(root: vscode.Uri): Promise<{ logFile: string; logPath: string; activePath: string } | null> {
	try {
		const logsDir = await ensureLogsDir(root);
		const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
		const logFile = `${stamp}-ext.jsonl`;
		const logPath = nodepath.join(logsDir, logFile);
		const activePath = nodepath.join(logsDir, 'active-session.json');

		const startEntry: LogEntry = { ts: nowIso(), event: 'session_start' };
		await nodefs.writeFile(logPath, JSON.stringify(startEntry) + '\n', 'utf8');

		const session: LogSession = {
			sessionId: `ext-${Date.now()}`,
			logFile,
			startedAt: nowIso(),
			status: 'active',
		};
		await nodefs.writeFile(activePath, JSON.stringify(session), 'utf8');

		return { logFile, logPath, activePath };
	} catch {
		return null;
	}
}

async function appendLogEntry(logPath: string, entry: LogEntry): Promise<void> {
	try {
		await nodefs.appendFile(logPath, JSON.stringify(entry) + '\n', 'utf8');
	} catch {
		// Non-fatal
	}
}

async function closeLogSession(logPath: string, activePath: string): Promise<void> {
	try {
		await nodefs.appendFile(logPath, JSON.stringify({ ts: nowIso(), event: 'session_end' }) + '\n', 'utf8');
		const raw = await nodefs.readFile(activePath, 'utf8');
		const session: LogSession = JSON.parse(raw);
		session.status = 'complete';
		session.endedAt = nowIso();
		await nodefs.writeFile(activePath, JSON.stringify(session), 'utf8');
	} catch {
		// Non-fatal
	}
}

// ---------------------------------------------------------------------------
// Log reading (for the webview feed)
// ---------------------------------------------------------------------------

async function readActiveSession(root: vscode.Uri): Promise<LogSession | null> {
	const uri = vscode.Uri.joinPath(root, '.spectacles', 'logs', 'active-session.json');
	const text = await readFileText(uri);
	if (!text) { return null; }
	try { return JSON.parse(text); } catch { return null; }
}

async function readLogEntries(root: vscode.Uri, logFile: string): Promise<LogEntry[]> {
	const uri = vscode.Uri.joinPath(root, '.spectacles', 'logs', logFile);
	const text = await readFileText(uri);
	if (!text) { return []; }
	return text
		.split('\n')
		.filter((l) => l.trim())
		.map((l) => { try { return JSON.parse(l) as LogEntry; } catch { return null; } })
		.filter((e): e is LogEntry => e !== null);
}

// ---------------------------------------------------------------------------
// Status / HTML
// ---------------------------------------------------------------------------

const STATUS_ORDER = ['not_started', 'requirements_complete', 'design_complete', 'ready_for_dev', 'complete'] as const;

function stepsCompleted(status: string): [boolean, boolean, boolean, boolean] {
	const idx = STATUS_ORDER.indexOf(status as typeof STATUS_ORDER[number]);
	return [idx >= 1, idx >= 2, idx >= 3, idx >= 4];
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function stepCircle(checked: boolean): string {
	return checked
		? `<div class="step-circle checked">✓</div>`
		: `<div class="step-circle unchecked"></div>`;
}

function buildHtml(data: BundleData): string {
	const { metadata } = data;
	const [reqDone, designDone, tasksDone, allDone] = stepsCompleted(metadata.status);

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Spectacles</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 28px 48px;
    line-height: 1.5;
  }
  h1 { font-size: 1.5em; font-weight: 600; margin-bottom: 4px; }
  h2 { font-size: 1em; font-weight: 600; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.6; }
  .subtitle { font-size: 0.95em; opacity: 0.75; margin-top: 4px; }
  .header { margin-bottom: 28px; }
  .header-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .description { margin-top: 10px; opacity: 0.8; }
  .refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    font-size: 0.85em;
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    cursor: pointer;
    margin-left: auto;
  }
  .refresh-btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.25)); }
  .steps {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    margin-bottom: 28px;
  }
  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
    min-width: 96px;
    padding: 0 8px;
  }
  .step-connector {
    flex: 1;
    height: 2px;
    background: var(--vscode-editorWidget-border, rgba(128,128,128,0.35));
    margin-top: 13px;
    min-width: 24px;
  }
  .step-circle {
    width: 28px; height: 28px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.85em; font-weight: 700; flex-shrink: 0;
    transition: background 0.2s;
  }
  .step-circle.checked { background: #22c55e; color: #fff; }
  .step-circle.unchecked {
    background: transparent;
    border: 2px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.45));
    opacity: 0.4;
  }
  .step-label { font-weight: 500; font-size: 0.9em; }
  .actions {
    display: flex;
    justify-content: center;
    margin-top: 8px;
    margin-bottom: 32px;
  }
  .draft-btn {
    padding: 7px 18px;
    border-radius: 4px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font-size: 0.9em;
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    cursor: pointer;
  }
  .draft-btn:hover { background: var(--vscode-button-hoverBackground); }

  /* Log feed */
  .log-section { margin-top: 4px; }
  .log-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 0;
    background: none;
    border: none;
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: 1em;
    cursor: pointer;
    text-align: left;
  }
  .log-toggle:hover { opacity: 0.85; }
  .log-toggle-label {
    font-size: 1em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.6;
  }
  .log-spinner {
    width: 11px; height: 11px;
    border: 1.5px solid rgba(128,128,128,0.25);
    border-top-color: var(--vscode-foreground);
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
    display: none;
    flex-shrink: 0;
  }
  .log-spinner.visible { display: block; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .log-chevron {
    margin-left: auto;
    font-size: 0.65em;
    opacity: 0.4;
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }
  .log-section.expanded .log-chevron { transform: rotate(90deg); }
  .log-entries-wrap { display: none; }
  .log-section.expanded .log-entries-wrap { display: block; }
  .log-entries {
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.2));
    border-radius: 4px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    margin-bottom: 8px;
  }
  .log-empty {
    padding: 16px 14px;
    opacity: 0.4;
    font-style: italic;
    font-size: 0.88em;
  }
  .log-entry {
    display: flex;
    gap: 10px;
    padding: 4px 12px;
    border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.07));
    font-size: 0.82em;
    line-height: 1.5;
    align-items: baseline;
  }
  .log-entry:last-child { border-bottom: none; }
  .log-time {
    flex-shrink: 0;
    opacity: 0.38;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.92em;
    min-width: 60px;
  }
  .log-icon { flex-shrink: 0; width: 14px; text-align: center; opacity: 0.6; }
  .log-text {
    flex: 1;
    white-space: pre-wrap;
    word-break: break-word;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    -webkit-box-orient: vertical;
  }
  .log-entry.start .log-text,
  .log-entry.end .log-text { opacity: 0.5; font-style: italic; }
  .log-entry.thought .log-text { opacity: 0.65; font-style: italic; }
  .log-entry.tool .log-text {
    color: var(--vscode-textLink-foreground, #6fa8dc);
    font-family: var(--vscode-editor-font-family, monospace);
  }
</style>
</head>
<body>

<div class="header">
  <div class="header-row">
    <h1>Spectacles</h1>
    <button class="refresh-btn" onclick="refresh()">↻ Refresh</button>
  </div>
  <p class="subtitle">Spec Name: ${escapeHtml(metadata.name)}</p>
  ${metadata.description ? `<p class="description">${escapeHtml(metadata.description)}</p>` : ''}
</div>

<div class="steps">
  <div class="step">
    ${stepCircle(reqDone)}
    <div class="step-label">Requirements</div>
  </div>
  <div class="step-connector"></div>
  <div class="step">
    ${stepCircle(designDone)}
    <div class="step-label">Design</div>
  </div>
  <div class="step-connector"></div>
  <div class="step">
    ${stepCircle(tasksDone)}
    <div class="step-label">Tasks</div>
  </div>
  <div class="step-connector"></div>
  <div class="step">
    ${stepCircle(allDone)}
    <div class="step-label">Done</div>
  </div>
</div>

<div class="actions">
  <button class="draft-btn" onclick="draftDesign()">Draft design from requirements</button>
</div>

<div class="log-section" id="log-section">
  <button class="log-toggle" onclick="toggleLog()">
    <span class="log-toggle-label">Agent Activity</span>
    <span class="log-spinner" id="log-spinner"></span>
    <span class="log-chevron">▶</span>
  </button>
  <div class="log-entries-wrap">
    <div class="log-entries" id="log-entries">
      <p class="log-empty">No recent agent activity.</p>
    </div>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  function refresh() { vscode.postMessage({ command: 'refresh' }); }
  function draftDesign() { vscode.postMessage({ command: 'draftDesign' }); }

  let expanded = false;

  function toggleLog() {
    expanded = !expanded;
    document.getElementById('log-section').classList.toggle('expanded', expanded);
    if (expanded) {
      const el = document.getElementById('log-entries');
      el.scrollTop = el.scrollHeight;
    }
  }

  function setSpinner(isActive) {
    document.getElementById('log-spinner').classList.toggle('visible', !!isActive);
  }

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return ''; }
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function entryHtml(entry) {
    const time = fmtTime(entry.ts);
    switch (entry.event) {
      case 'session_start':
        return \`<div class="log-entry start"><span class="log-time">\${esc(time)}</span><span class="log-icon">▶</span><span class="log-text">Agent session started</span></div>\`;
      case 'session_end':
        return \`<div class="log-entry end"><span class="log-time">\${esc(time)}</span><span class="log-icon">■</span><span class="log-text">Agent session ended</span></div>\`;
      case 'agent_response':
        return \`<div class="log-entry response"><span class="log-time">\${esc(time)}</span><span class="log-icon">◆</span><span class="log-text">\${esc(entry.text)}</span></div>\`;
      case 'agent_thought':
        return \`<div class="log-entry thought"><span class="log-time">\${esc(time)}</span><span class="log-icon">…</span><span class="log-text">\${esc(entry.text)}</span></div>\`;
      case 'tool_use':
        return \`<div class="log-entry tool"><span class="log-time">\${esc(time)}</span><span class="log-icon">⚙</span><span class="log-text">\${esc(entry.label || entry.tool)}</span></div>\`;
      default:
        return '';
    }
  }

  // Streaming: a single response entry that grows in place as chunks arrive
  function getOrCreateStreamEntry() {
    const feed = document.getElementById('log-entries');
    let el = document.getElementById('log-stream-entry');
    if (!el) {
      const empty = feed.querySelector('.log-empty');
      if (empty) { feed.innerHTML = ''; }
      feed.insertAdjacentHTML('beforeend',
        \`<div class="log-entry response" id="log-stream-entry">\` +
        \`<span class="log-time">\${fmtTime(new Date().toISOString())}</span>\` +
        \`<span class="log-icon">◆</span>\` +
        \`<span class="log-text" id="log-stream-text"></span>\` +
        \`</div>\`
      );
      el = document.getElementById('log-stream-entry');
    }
    return el;
  }

  function finalizeStreamEntry() {
    const el = document.getElementById('log-stream-entry');
    if (el) { el.removeAttribute('id'); }
    const t = document.getElementById('log-stream-text');
    if (t) { t.removeAttribute('id'); }
  }

  function handleStreamChunk(text, isActive) {
    setSpinner(isActive);
    getOrCreateStreamEntry();
    const textEl = document.getElementById('log-stream-text');
    if (textEl) { textEl.textContent += text; }
    const feed = document.getElementById('log-entries');
    if (expanded) { feed.scrollTop = feed.scrollHeight; }
  }

  function setFeed(entries, isActive) {
    finalizeStreamEntry();
    setSpinner(isActive);
    const el = document.getElementById('log-entries');
    if (!entries || !entries.length) {
      el.innerHTML = '<p class="log-empty">No recent agent activity.</p>';
      return;
    }
    el.innerHTML = entries.map(entryHtml).filter(Boolean).join('');
    if (expanded) { el.scrollTop = el.scrollHeight; }
  }

  function appendFeed(entries, isActive) {
    finalizeStreamEntry();
    setSpinner(isActive);
    const el = document.getElementById('log-entries');
    const empty = el.querySelector('.log-empty');
    if (empty) { el.innerHTML = ''; }
    const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 12;
    for (const entry of entries) {
      const html = entryHtml(entry);
      if (!html) { continue; }
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      el.appendChild(tmp.firstChild);
    }
    if (expanded && atBottom) { el.scrollTop = el.scrollHeight; }
  }

  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (msg.command === 'setLogs') { setFeed(msg.entries, msg.isActive); }
    else if (msg.command === 'appendLogs') { appendFeed(msg.entries, msg.isActive); }
    else if (msg.command === 'streamChunk') { handleStreamChunk(msg.text, msg.isActive); }
  });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

function stripFrontMatter(content: string): string {
	if (!content.startsWith('---')) { return content; }
	const end = content.indexOf('\n---', 3);
	if (end === -1) { return content; }
	return content.slice(end + 4).trimStart();
}

type PostFn = (command: string, payload: Record<string, unknown>) => void;

// Shape of the relevant fields in stream-json events
interface StreamEvent {
	type: 'system' | 'assistant' | 'tool_call' | 'result' | string;
	subtype?: string;
	timestamp_ms?: number;
	model_call_id?: string;
	message?: { content?: Array<{ text?: string }> };
	tool_call?: {
		writeToolCall?: { args?: { path?: string } };
		readToolCall?: { args?: { path?: string } };
		editToolCall?: { args?: { path?: string } };
		shellToolCall?: { args?: { command?: string } };
	};
}

function toolLabel(tc: StreamEvent['tool_call']): string {
	if (!tc) { return 'Tool call'; }
	if (tc.writeToolCall) { return `Write ${tc.writeToolCall.args?.path ?? ''}`; }
	if (tc.editToolCall) { return `Edit ${tc.editToolCall.args?.path ?? ''}`; }
	if (tc.readToolCall) { return `Read ${tc.readToolCall.args?.path ?? ''}`; }
	if (tc.shellToolCall) {
		const cmd = tc.shellToolCall.args?.command ?? '';
		return `Shell: ${cmd.slice(0, 60)}${cmd.length > 60 ? '…' : ''}`;
	}
	return 'Tool call';
}

async function runDraftDesign(bundleUri: vscode.Uri, post: PostFn): Promise<void> {
	const root = getWorkspaceRootUri();
	if (!root) {
		vscode.window.showErrorMessage('Open a folder/workspace first.');
		return;
	}

	const agentUri = resolveLayoutUri(root, '.cursor/agents/spectacles.draft-design.md');
	if (!(await pathExists(agentUri))) {
		vscode.window.showErrorMessage(
			'spectacles.draft-design agent not found. Run Spectacles: Init first.'
		);
		return;
	}

	const bytes = await vscode.workspace.fs.readFile(agentUri);
	const agentContent = stripFrontMatter(Buffer.from(bytes).toString('utf8'));
	const fullPrompt = `${agentContent}\n\n${bundleUri.fsPath}\n`;

	const output = getOutputChannel();
	output.clear();
	output.appendLine(`[spectacles] draft-design → ${bundleUri.fsPath}`);
	output.appendLine('');
	output.show(true);

	const logSession = await createLogSession(root);
	post('setLogs', { entries: [{ ts: nowIso(), event: 'session_start' }], isActive: true });

	const child = spawn(
		'cursor',
		['agent', '-p', '--force', '--output-format', 'stream-json', '--stream-partial-output', fullPrompt],
		{ cwd: root.fsPath, shell: false }
	);

	let lineBuffer = '';
	let fullResponseText = '';

	child.stdout.on('data', (d: Buffer) => {
		lineBuffer += d.toString();
		const lines = lineBuffer.split('\n');
		lineBuffer = lines.pop() ?? '';

		for (const line of lines) {
			if (!line.trim()) { continue; }
			output.appendLine(line);

			let event: StreamEvent;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}

			const { type, subtype } = event;

			if (type === 'assistant' && 'timestamp_ms' in event && !('model_call_id' in event)) {
				// Streaming text delta — send immediately so the webview updates in real-time
				const text = event.message?.content?.[0]?.text ?? '';
				if (text) {
					fullResponseText += text;
					post('streamChunk', { text, isActive: true });
				}
			} else if (type === 'tool_call' && subtype === 'started') {
				const entry: LogEntry = { ts: nowIso(), event: 'tool_use', label: toolLabel(event.tool_call) };
				if (logSession) { appendLogEntry(logSession.logPath, entry); }
				post('appendLogs', { entries: [entry], isActive: true });
			}
		}
	});

	child.stderr.on('data', (d: Buffer) => output.append(d.toString()));

	child.on('close', async (code) => {
		const endEntry: LogEntry = { ts: nowIso(), event: 'session_end' };
		if (logSession) {
			if (fullResponseText.trim()) {
				await appendLogEntry(logSession.logPath, { ts: nowIso(), event: 'agent_response', text: fullResponseText });
			}
			await appendLogEntry(logSession.logPath, endEntry);
			await closeLogSession(logSession.logPath, logSession.activePath);
		}
		post('appendLogs', { entries: [endEntry], isActive: false });

		output.appendLine('');
		if (code !== 0) {
			output.appendLine(`[spectacles] exited with code ${code}`);
			vscode.window.showErrorMessage(`draft-design failed (exit ${code}). See Output → Spectacles.`);
		} else {
			output.appendLine('[spectacles] done');
			vscode.window.showInformationMessage('Design drafted. See Output → Spectacles.');
		}
	});

	child.on('error', (err: Error) => {
		output.appendLine(`[spectacles] error: ${err.message}`);
		vscode.window.showErrorMessage(`draft-design error: ${err.message}`);
		post('appendLogs', { entries: [{ ts: nowIso(), event: 'session_end' }], isActive: false });
	});
}

// ---------------------------------------------------------------------------
// Log feed updates for a panel
// ---------------------------------------------------------------------------

async function sendCurrentLogs(
	root: vscode.Uri,
	panel: vscode.WebviewPanel,
	state: Pick<PanelState, 'currentLogFile' | 'currentLineCount'>,
	mode: 'set' | 'append'
): Promise<void> {
	const session = await readActiveSession(root);
	const isActive = session?.status === 'active';

	if (!session) {
		if (mode === 'set') {
			panel.webview.postMessage({ command: 'setLogs', entries: [], isActive: false });
		}
		return;
	}

	if (mode === 'set' || session.logFile !== state.currentLogFile) {
		state.currentLogFile = session.logFile;
		state.currentLineCount = 0;
		const entries = await readLogEntries(root, session.logFile);
		state.currentLineCount = entries.length;
		panel.webview.postMessage({ command: 'setLogs', entries, isActive });
		return;
	}

	const entries = await readLogEntries(root, session.logFile);
	if (entries.length > state.currentLineCount) {
		const newEntries = entries.slice(state.currentLineCount);
		state.currentLineCount = entries.length;
		panel.webview.postMessage({ command: 'appendLogs', entries: newEntries, isActive });
	}
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

export async function runViewBundleStatus(
	uri: vscode.Uri,
	context: vscode.ExtensionContext
): Promise<void> {
	if (!uri) {
		vscode.window.showErrorMessage('No folder selected.');
		return;
	}

	const data = await readBundleData(uri);
	if (!data) {
		vscode.window.showErrorMessage(
			'Not a valid specification bundle. The directory must contain a metadata.json with spec_version, name, id, and status.'
		);
		return;
	}

	const panelId = data.metadata.id;
	const root = getWorkspaceRootUri();

	const existing = openPanels.get(panelId);
	if (existing) {
		existing.panel.reveal();
		existing.panel.webview.html = buildHtml(data);
		if (root) {
			setTimeout(() => sendCurrentLogs(root, existing.panel, existing, 'set'), 150);
		}
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		'spectacles.bundleStatus',
		'Spectacles',
		vscode.ViewColumn.Beside,
		{ enableScripts: true, retainContextWhenHidden: true }
	);

	panel.webview.html = buildHtml(data);

	const state: PanelState = {
		panel,
		uri,
		logWatcher: null,
		currentLogFile: null,
		currentLineCount: 0,
	};

	if (root) {
		// Watch the logs directory for any changes (new files, appends)
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(root, '.spectacles/logs/**')
		);

		const onLogChange = () => sendCurrentLogs(root, panel, state, 'append');
		watcher.onDidChange(onLogChange, null, context.subscriptions);
		watcher.onDidCreate(onLogChange, null, context.subscriptions);

		state.logWatcher = watcher;

		// Load any existing logs once the webview is ready
		setTimeout(() => sendCurrentLogs(root, panel, state, 'set'), 150);
	}

	const postToPanel: PostFn = (command, payload) =>
		panel.webview.postMessage({ command, ...payload });

	panel.webview.onDidReceiveMessage(async (message) => {
		if (message.command === 'refresh') {
			const refreshed = await readBundleData(uri);
			if (refreshed) {
				panel.webview.html = buildHtml(refreshed);
				if (root) {
					setTimeout(() => sendCurrentLogs(root, panel, state, 'set'), 150);
				}
			}
		} else if (message.command === 'draftDesign') {
			await runDraftDesign(uri, postToPanel);
		}
	}, null, context.subscriptions);

	openPanels.set(panelId, state);

	panel.onDidDispose(() => {
		openPanels.delete(panelId);
		state.logWatcher?.dispose();
	}, null, context.subscriptions);
}
