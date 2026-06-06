import * as nodefs from 'fs/promises';
import * as nodepath from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { getWorkspaceRootUri, resolveLayoutUri, pathExists } from './layout';
import { getOutputChannel } from './runPrompt';

// ---------------------------------------------------------------------------
// Shared types (re-exported for consumers)
// ---------------------------------------------------------------------------

export interface LogEntry {
	ts: string;
	event: 'session_start' | 'session_end' | 'agent_response' | 'agent_thought' | 'tool_use' | string;
	sessionId?: string;
	text?: string;
	tool?: string;
	label?: string;
}

export type PostFn = (command: string, payload: Record<string, unknown>) => void;

// ---------------------------------------------------------------------------
// Webview HTML config
// ---------------------------------------------------------------------------

export interface AgentActionHtmlConfig {
	/** Label for the run button. Defaults to "Run Agent". */
	buttonLabel?: string;
	/** The message command posted to the extension when the button is clicked. */
	command: string;
	/** Unique instance ID. Defaults to 'aa'. Must be unique per page when multiple components coexist. */
	id?: string;
}

// ---------------------------------------------------------------------------
// agentActionCss — call once per page inside a <style> block
// ---------------------------------------------------------------------------

export function agentActionCss(): string {
	return `
  /* Agent Action Component */
  .agent-action { margin-bottom: 0; }
  .agent-action-trigger {
    display: flex;
    justify-content: center;
    margin-bottom: 20px;
  }
  .agent-run-btn {
    padding: 7px 18px;
    border-radius: 4px;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font-size: 0.9em;
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    cursor: pointer;
  }
  .agent-run-btn:hover { background: var(--vscode-button-hoverBackground); }
  .agent-action-running {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 20px;
    font-size: 0.9em;
    opacity: 0.75;
  }
  .agent-running-spinner {
    width: 11px; height: 11px;
    border: 1.5px solid rgba(128,128,128,0.25);
    border-top-color: var(--vscode-foreground);
    border-radius: 50%;
    animation: aa-spin 0.75s linear infinite;
    flex-shrink: 0;
  }
  @keyframes aa-spin { to { transform: rotate(360deg); } }
  /* Log feed */
  .aa-log-section { margin-top: 4px; }
  .aa-log-toggle {
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
  .aa-log-toggle:hover { opacity: 0.85; }
  .aa-log-toggle-label {
    font-size: 1em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.6;
  }
  .aa-log-spinner {
    width: 11px; height: 11px;
    border: 1.5px solid rgba(128,128,128,0.25);
    border-top-color: var(--vscode-foreground);
    border-radius: 50%;
    animation: aa-spin 0.75s linear infinite;
    display: none;
    flex-shrink: 0;
  }
  .aa-log-spinner.visible { display: block; }
  .aa-log-chevron {
    margin-left: auto;
    font-size: 0.65em;
    opacity: 0.4;
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }
  .aa-log-section.expanded .aa-log-chevron { transform: rotate(90deg); }
  .aa-log-entries-wrap { display: none; }
  .aa-log-section.expanded .aa-log-entries-wrap { display: block; }
  .aa-log-entries {
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.2));
    border-radius: 4px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    margin-bottom: 8px;
  }
  .aa-log-empty {
    padding: 16px 14px;
    opacity: 0.4;
    font-style: italic;
    font-size: 0.88em;
  }
  .aa-log-entry {
    display: flex;
    gap: 10px;
    padding: 4px 12px;
    border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(128,128,128,0.07));
    font-size: 0.82em;
    line-height: 1.5;
    align-items: baseline;
  }
  .aa-log-entry:last-child { border-bottom: none; }
  .aa-log-time {
    flex-shrink: 0;
    opacity: 0.38;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.92em;
    min-width: 60px;
  }
  .aa-log-icon { flex-shrink: 0; width: 14px; text-align: center; opacity: 0.6; }
  .aa-log-text {
    flex: 1;
    white-space: pre-wrap;
    word-break: break-word;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    -webkit-box-orient: vertical;
  }
  .aa-log-entry.start .aa-log-text,
  .aa-log-entry.end .aa-log-text { opacity: 0.5; font-style: italic; }
  .aa-log-entry.thought .aa-log-text { opacity: 0.65; font-style: italic; }
  .aa-log-entry.tool .aa-log-text {
    color: var(--vscode-textLink-foreground, #6fa8dc);
    font-family: var(--vscode-editor-font-family, monospace);
  }
`;
}

// ---------------------------------------------------------------------------
// agentActionHtml — embed once per component instance
// ---------------------------------------------------------------------------

export function agentActionHtml(config: AgentActionHtmlConfig): string {
	const id = config.id ?? 'aa';
	const label = config.buttonLabel ?? 'Run Agent';
	return `
<div class="agent-action" id="${id}">
  <div class="agent-action-trigger" id="${id}-trigger">
    <button class="agent-run-btn" onclick="${id}_run()">${label}</button>
  </div>
  <div class="agent-action-running" id="${id}-running" style="display:none">
    <span class="agent-running-label">Running...</span>
    <span class="agent-running-spinner"></span>
  </div>
  <div class="aa-log-section" id="${id}-log-section">
    <button class="aa-log-toggle" onclick="${id}_toggleLog()">
      <span class="aa-log-toggle-label">Agent Activity</span>
      <span class="aa-log-spinner" id="${id}-log-spinner"></span>
      <span class="aa-log-chevron">&#9658;</span>
    </button>
    <div class="aa-log-entries-wrap">
      <div class="aa-log-entries" id="${id}-log-entries">
        <p class="aa-log-empty">No recent agent activity.</p>
      </div>
    </div>
  </div>
</div>
`;
}

// ---------------------------------------------------------------------------
// agentActionJs — embed once per component instance (after the HTML)
// ---------------------------------------------------------------------------

export function agentActionJs(config: AgentActionHtmlConfig): string {
	const id = config.id ?? 'aa';
	const command = config.command;

	// All logic is wrapped in an IIFE so multiple instances don't collide.
	// Global functions named `{id}_run` and `{id}_toggleLog` are exposed for
	// the inline onclick handlers.
	return `
<script>
(function() {
  var ID = ${JSON.stringify(id)};
  var CMD = ${JSON.stringify(command)};
  var expanded = false;

  function $$(sfx) { return document.getElementById(ID + sfx); }

  function setRunning(isRunning) {
    var trigger = $$(('-trigger'));
    var running = $$(('-running'));
    if (trigger) { trigger.style.display = isRunning ? 'none' : ''; }
    if (running) { running.style.display = isRunning ? '' : 'none'; }
  }

  function setExpanded(val) {
    expanded = val;
    var section = $$(('-log-section'));
    if (section) { section.classList.toggle('expanded', expanded); }
    if (expanded) {
      var el = $$(('-log-entries'));
      if (el) { el.scrollTop = el.scrollHeight; }
    }
  }

  function setSpinner(isActive) {
    var el = $$(('-log-spinner'));
    if (el) { el.classList.toggle('visible', !!isActive); }
  }

  function fmtTime(ts) {
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch (e) { return ''; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function entryHtml(entry) {
    var time = fmtTime(entry.ts);
    switch (entry.event) {
      case 'session_start':
        return '<div class="aa-log-entry start"><span class="aa-log-time">' + esc(time) + '</span><span class="aa-log-icon">&#9658;</span><span class="aa-log-text">Agent session started</span></div>';
      case 'session_end':
        return '<div class="aa-log-entry end"><span class="aa-log-time">' + esc(time) + '</span><span class="aa-log-icon">&#9632;</span><span class="aa-log-text">Agent session ended</span></div>';
      case 'agent_response':
        return '<div class="aa-log-entry response"><span class="aa-log-time">' + esc(time) + '</span><span class="aa-log-icon">&#9670;</span><span class="aa-log-text">' + esc(entry.text) + '</span></div>';
      case 'agent_thought':
        return '<div class="aa-log-entry thought"><span class="aa-log-time">' + esc(time) + '</span><span class="aa-log-icon">&#8230;</span><span class="aa-log-text">' + esc(entry.text) + '</span></div>';
      case 'tool_use':
        return '<div class="aa-log-entry tool"><span class="aa-log-time">' + esc(time) + '</span><span class="aa-log-icon">&#9881;</span><span class="aa-log-text">' + esc(entry.label || entry.tool) + '</span></div>';
      default:
        return '';
    }
  }

  function getOrCreateStreamEntry() {
    var feed = $$(('-log-entries'));
    var el = document.getElementById(ID + '-stream-entry');
    if (!el) {
      var empty = feed ? feed.querySelector('.aa-log-empty') : null;
      if (empty) { feed.innerHTML = ''; }
      if (feed) {
        feed.insertAdjacentHTML('beforeend',
          '<div class="aa-log-entry response" id="' + ID + '-stream-entry">' +
          '<span class="aa-log-time">' + fmtTime(new Date().toISOString()) + '</span>' +
          '<span class="aa-log-icon">&#9670;</span>' +
          '<span class="aa-log-text" id="' + ID + '-stream-text"></span>' +
          '</div>'
        );
        el = document.getElementById(ID + '-stream-entry');
      }
    }
    return el;
  }

  function finalizeStreamEntry() {
    var el = document.getElementById(ID + '-stream-entry');
    if (el) { el.removeAttribute('id'); }
    var t = document.getElementById(ID + '-stream-text');
    if (t) { t.removeAttribute('id'); }
  }

  function handleStreamChunk(text, isActive) {
    setSpinner(isActive);
    getOrCreateStreamEntry();
    var textEl = document.getElementById(ID + '-stream-text');
    if (textEl) { textEl.textContent += text; }
    var feed = $$(('-log-entries'));
    if (expanded && feed) { feed.scrollTop = feed.scrollHeight; }
  }

  function setFeed(entries, isActive) {
    finalizeStreamEntry();
    setSpinner(isActive);
    var el = $$(('-log-entries'));
    if (!el) { return; }
    if (!entries || !entries.length) {
      el.innerHTML = '<p class="aa-log-empty">No recent agent activity.</p>';
      return;
    }
    el.innerHTML = entries.map(entryHtml).filter(Boolean).join('');
    if (expanded) { el.scrollTop = el.scrollHeight; }
  }

  function appendFeed(entries, isActive) {
    finalizeStreamEntry();
    setSpinner(isActive);
    // When the session ends, transition back to idle (show button, hide running)
    if (!isActive) { setRunning(false); }
    var el = $$(('-log-entries'));
    if (!el) { return; }
    var empty = el.querySelector('.aa-log-empty');
    if (empty) { el.innerHTML = ''; }
    var atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 12;
    for (var i = 0; i < entries.length; i++) {
      var html = entryHtml(entries[i]);
      if (!html) { continue; }
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      el.appendChild(tmp.firstChild);
    }
    if (expanded && atBottom) { el.scrollTop = el.scrollHeight; }
  }

  window.addEventListener('message', function(ev) {
    var msg = ev.data;
    if (msg.target !== ID) { return; }
    if (msg.command === 'setLogs') { setFeed(msg.entries, msg.isActive); }
    else if (msg.command === 'appendLogs') { appendFeed(msg.entries, msg.isActive); }
    else if (msg.command === 'streamChunk') { handleStreamChunk(msg.text, msg.isActive); }
  });

  // Expose functions for inline onclick handlers
  window[ID + '_run'] = function() {
    setRunning(true);
    setExpanded(true);
    var vscode = window.__vscodeApi;
    if (vscode) { vscode.postMessage({ command: CMD }); }
  };

  window[ID + '_toggleLog'] = function() {
    setExpanded(!expanded);
  };
})();
</script>
`;
}

// ---------------------------------------------------------------------------
// Extension-side: generic agent runner
// ---------------------------------------------------------------------------

interface LogSession {
	logFile: string;
	logPath: string;
	activePath: string;
}

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

export interface AgentRunOptions {
	/** Resolved URI of the .md agent file (front matter will be stripped). */
	agentUri: vscode.Uri;
	/** Text appended to the agent prompt (e.g. the bundle directory path). */
	promptSuffix: string;
	/** Function that posts a message back to the webview panel. */
	post: PostFn;
	/** Workspace root URI (used for log file paths and cwd). */
	root: vscode.Uri;
	/** Component instance ID to route messages back to. Defaults to 'aa'. */
	target?: string;
}

function nowIso(): string {
	return new Date().toISOString();
}

async function ensureLogsDir(root: vscode.Uri): Promise<string> {
	const dir = vscode.Uri.joinPath(root, '.spectacles', 'logs');
	await vscode.workspace.fs.createDirectory(dir);
	return nodepath.join(root.fsPath, '.spectacles', 'logs');
}

async function createLogSession(root: vscode.Uri): Promise<LogSession | null> {
	try {
		const logsDir = await ensureLogsDir(root);
		const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
		const logFile = `${stamp}-ext.jsonl`;
		const logPath = nodepath.join(logsDir, logFile);
		const activePath = nodepath.join(logsDir, 'active-session.json');

		const startEntry: LogEntry = { ts: nowIso(), event: 'session_start' };
		await nodefs.writeFile(logPath, JSON.stringify(startEntry) + '\n', 'utf8');

		const session = {
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
		const session = JSON.parse(raw);
		session.status = 'complete';
		session.endedAt = nowIso();
		await nodefs.writeFile(activePath, JSON.stringify(session), 'utf8');
	} catch {
		// Non-fatal
	}
}

function toolLabel(tc: StreamEvent['tool_call']): string {
	if (!tc) { return 'Tool call'; }
	if (tc.writeToolCall) { return `Write ${tc.writeToolCall.args?.path ?? ''}`; }
	if (tc.editToolCall) { return `Edit ${tc.editToolCall.args?.path ?? ''}`; }
	if (tc.readToolCall) { return `Read ${tc.readToolCall.args?.path ?? ''}`; }
	if (tc.shellToolCall) {
		const cmd = tc.shellToolCall.args?.command ?? '';
		return `Shell: ${cmd.slice(0, 60)}${cmd.length > 60 ? '\u2026' : ''}`;
	}
	return 'Tool call';
}

function stripFrontMatter(content: string): string {
	if (!content.startsWith('---')) { return content; }
	const end = content.indexOf('\n---', 3);
	if (end === -1) { return content; }
	return content.slice(end + 4).trimStart();
}

export async function runAgentAction(options: AgentRunOptions): Promise<void> {
	const { agentUri, promptSuffix, post, root } = options;
	const target = options.target ?? 'aa';

	if (!(await pathExists(agentUri))) {
		vscode.window.showErrorMessage(
			`Agent file not found: ${agentUri.fsPath}. Run Spectacles: Init first.`
		);
		return;
	}

	const bytes = await vscode.workspace.fs.readFile(agentUri);
	const agentContent = stripFrontMatter(Buffer.from(bytes).toString('utf8'));
	const fullPrompt = `${agentContent}\n\n${promptSuffix}\n`;

	const output = getOutputChannel();
	output.clear();
	output.appendLine(`[spectacles] agent → ${promptSuffix}`);
	output.appendLine('');
	output.show(true);

	const logSession = await createLogSession(root);
	post('setLogs', { target, entries: [{ ts: nowIso(), event: 'session_start' }], isActive: true });

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
				const text = event.message?.content?.[0]?.text ?? '';
				if (text) {
					fullResponseText += text;
					post('streamChunk', { target, text, isActive: true });
				}
			} else if (type === 'tool_call' && subtype === 'started') {
				const entry: LogEntry = { ts: nowIso(), event: 'tool_use', label: toolLabel(event.tool_call) };
				if (logSession) { appendLogEntry(logSession.logPath, entry); }
				post('appendLogs', { target, entries: [entry], isActive: true });
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
		post('appendLogs', { target, entries: [endEntry], isActive: false });

		output.appendLine('');
		if (code !== 0) {
			output.appendLine(`[spectacles] exited with code ${code}`);
			vscode.window.showErrorMessage(`Agent run failed (exit ${code}). See Output → Spectacles.`);
		} else {
			output.appendLine('[spectacles] done');
			vscode.window.showInformationMessage('Agent run complete. See Output → Spectacles.');
		}
	});

	child.on('error', (err: Error) => {
		output.appendLine(`[spectacles] error: ${err.message}`);
		vscode.window.showErrorMessage(`Agent run error: ${err.message}`);
		post('appendLogs', { target, entries: [{ ts: nowIso(), event: 'session_end' }], isActive: false });
	});
}

// ---------------------------------------------------------------------------
// Re-export resolveLayoutUri so consumers can locate agent files uniformly
// ---------------------------------------------------------------------------
export { resolveLayoutUri, getWorkspaceRootUri };
