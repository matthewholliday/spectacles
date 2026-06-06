import * as vscode from 'vscode';

type PatternType = 'Ubiquitous' | 'State-Driven' | 'Event-Driven' | 'Unwanted-Behavior' | 'Optional-Feature' | 'Complex';

interface EarsRequirement {
	id: string;
	pattern_type: PatternType;
	preconditions?: string[];
	trigger?: string;
	unwanted_condition?: string;
	feature_trigger?: string;
	system_name: string;
	responses: string[];
	full_text: string;
}

interface RequirementsData {
	id: string;
	lastReviewedBy: string[];
	targetAudience: string[];
	requirements: EarsRequirement[];
}

function parseFrontMatter(text: string): RequirementsData {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
	if (!match) {
		return { id: '', lastReviewedBy: [], targetAudience: [], requirements: [] };
	}

	const yaml = match[1];
	const body = match[2] ?? '';

	const getScalar = (key: string): string => {
		const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
		return m ? m[1].trim() : '';
	};

	const getArray = (key: string): string[] => {
		const m = yaml.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
		if (!m) { return []; }
		const val = m[1].trim();
		if (!val || val === '[]') { return []; }
		return val
			.replace(/^\[|\]$/g, '')
			.split(',')
			.map(s => s.trim().replace(/^["']|["']$/g, ''))
			.filter(Boolean);
	};

	let requirements: EarsRequirement[] = [];
	const trimmedBody = body.trim();
	if (trimmedBody) {
		try {
			const parsed = JSON.parse(trimmedBody);
			if (Array.isArray(parsed)) {
				requirements = parsed as EarsRequirement[];
			}
		} catch {
			// malformed body; start with empty list
		}
	}

	return {
		id: getScalar('id'),
		lastReviewedBy: getArray('last_reviewed_by'),
		targetAudience: getArray('target_audience'),
		requirements,
	};
}

function stringifyDocument(data: RequirementsData): string {
	const arr = (a: string[]) =>
		a.length === 0 ? '[]' : `[${a.map(s => `"${s}"`).join(', ')}]`;
	const yaml = [
		`id: ${data.id}`,
		`last_reviewed_by: ${arr(data.lastReviewedBy)}`,
		`target_audience: ${arr(data.targetAudience)}`,
	].join('\n');
	const body = JSON.stringify(data.requirements, null, 2);
	return `---\n${yaml}\n---\n${body}\n`;
}

export class RequirementsEditorProvider implements vscode.CustomTextEditorProvider {

	public static readonly viewType = 'spectacles.requirementsEditor';

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(
			RequirementsEditorProvider.viewType,
			new RequirementsEditorProvider(context),
			{ webviewOptions: { retainContextWhenHidden: true } }
		);
	}

	constructor(private readonly context: vscode.ExtensionContext) {}

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = this.getHtmlForWebview();

		function updateWebview() {
			const parsed = parseFrontMatter(document.getText());
			webviewPanel.webview.postMessage({ type: 'update', data: parsed });
		}

		updateWebview();

		const changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === document.uri.toString()) {
				updateWebview();
			}
		});

		webviewPanel.onDidDispose(() => changeSubscription.dispose());

		webviewPanel.webview.onDidReceiveMessage(e => {
			const current = parseFrontMatter(document.getText());

			if (e.type === 'edit') {
				switch (e.key) {
					case 'id':
						current.id = e.value;
						break;
					case 'lastReviewedBy':
						current.lastReviewedBy = e.value
							? (e.value as string).split(',').map((s: string) => s.trim()).filter(Boolean)
							: [];
						break;
					case 'targetAudience':
						current.targetAudience = e.value
							? (e.value as string).split(',').map((s: string) => s.trim()).filter(Boolean)
							: [];
						break;
				}
			} else if (e.type === 'editReq') {
				const req = current.requirements[e.index as number];
				if (!req) { return; }
				const field = e.field as keyof EarsRequirement;
				if (field === 'responses' || field === 'preconditions') {
					(req as unknown as Record<string, unknown>)[field] = e.value
						? (e.value as string).split('\n').map((s: string) => s.trim()).filter(Boolean)
						: [];
				} else {
					(req as unknown as Record<string, unknown>)[field] = e.value;
				}
			} else if (e.type === 'addReq') {
				const nextId = `REQ-${String(current.requirements.length + 1).padStart(3, '0')}`;
				current.requirements.push({
					id: nextId,
					pattern_type: 'Ubiquitous',
					system_name: '',
					responses: [],
					full_text: '',
				});
			} else if (e.type === 'deleteReq') {
				current.requirements.splice(e.index as number, 1);
			} else {
				return;
			}

			const newText = stringifyDocument(current);
			const edit = new vscode.WorkspaceEdit();
			edit.replace(
				document.uri,
				new vscode.Range(0, 0, document.lineCount, 0),
				newText
			);
			vscode.workspace.applyEdit(edit);
		});
	}

	private getHtmlForWebview(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Requirements Editor</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 28px 64px;
    line-height: 1.5;
    max-width: 900px;
  }
  .section-label {
    font-size: 0.75em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.5;
    margin-bottom: 14px;
  }
  .metadata-panel {
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    padding-bottom: 24px;
    margin-bottom: 28px;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .field.full-width { grid-column: span 2; }
  label {
    font-size: 0.82em;
    font-weight: 500;
    opacity: 0.7;
  }
  input, textarea, select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    padding: 5px 8px;
    font-family: inherit;
    font-size: inherit;
    outline: none;
    width: 100%;
  }
  input::placeholder, textarea::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }
  input:focus, textarea:focus, select:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -1px;
  }
  select option { background: var(--vscode-dropdown-background, #1e1e1e); }
  textarea {
    resize: vertical;
    min-height: 64px;
    font-family: inherit;
    line-height: 1.6;
  }
  .hint {
    font-size: 0.78em;
    opacity: 0.45;
  }

  /* Requirements list */
  .reqs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 2px;
    padding: 5px 12px;
    font-family: inherit;
    font-size: 0.85em;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
    color: var(--vscode-button-secondaryForeground, inherit);
  }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.25)); }
  .btn-danger {
    background: transparent;
    color: var(--vscode-errorForeground, #f44);
    border: 1px solid var(--vscode-errorForeground, #f44);
    padding: 3px 8px;
    font-size: 0.8em;
  }
  .btn-danger:hover { background: rgba(255,68,68,0.1); }

  .req-card {
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    border-radius: 4px;
    margin-bottom: 10px;
    overflow: hidden;
  }
  .req-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    cursor: pointer;
    user-select: none;
    background: var(--vscode-sideBar-background, rgba(128,128,128,0.05));
  }
  .req-card-header:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.1)); }
  .req-card-id {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.82em;
    opacity: 0.7;
    min-width: 70px;
  }
  .req-card-pattern {
    font-size: 0.75em;
    padding: 2px 7px;
    border-radius: 10px;
    background: var(--vscode-badge-background, rgba(128,128,128,0.2));
    color: var(--vscode-badge-foreground, inherit);
    white-space: nowrap;
  }
  .req-card-preview {
    flex: 1;
    opacity: 0.75;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.9em;
  }
  .chevron {
    opacity: 0.5;
    font-size: 0.8em;
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  .chevron.open { transform: rotate(90deg); }

  .req-card-body {
    display: none;
    padding: 16px 14px;
    border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
  }
  .req-card-body.open { display: block; }

  .req-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 14px;
  }
  .req-grid .field.full-width { grid-column: span 2; }
  .full-text-preview {
    background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.1));
    border-left: 3px solid var(--vscode-focusBorder, #007fd4);
    padding: 10px 14px;
    border-radius: 0 4px 4px 0;
    font-size: 0.9em;
    line-height: 1.6;
    margin-top: 4px;
    font-style: italic;
    opacity: 0.85;
    word-break: break-word;
  }
  .req-card-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 14px;
  }
  .empty-state {
    text-align: center;
    opacity: 0.4;
    padding: 32px 0;
    font-size: 0.9em;
  }
</style>
</head>
<body>

<div class="metadata-panel">
  <div class="section-label">Spec Metadata</div>
  <div class="meta-grid">
    <div class="field">
      <label for="id-input">Spec ID</label>
      <input type="text" id="id-input" placeholder="my-feature" spellcheck="false" autocomplete="off" />
    </div>
    <div class="field">
      <label for="target-audience-input">Target Audience</label>
      <input type="text" id="target-audience-input" placeholder="Product, Engineering" />
      <span class="hint">Comma-separated</span>
    </div>
    <div class="field full-width">
      <label for="last-reviewed-by-input">Last Reviewed By</label>
      <input type="text" id="last-reviewed-by-input" placeholder="Alice, Bob" />
      <span class="hint">Comma-separated</span>
    </div>
  </div>
</div>

<div class="reqs-header">
  <div class="section-label" style="margin-bottom:0">Requirements</div>
  <button class="btn" id="add-req-btn">+ Add Requirement</button>
</div>

<div id="req-list"></div>

<script>
  const vscode = acquireVsCodeApi();

  let state = { id: '', lastReviewedBy: [], targetAudience: [], requirements: [] };

  const PATTERN_TYPES = ['Ubiquitous', 'State-Driven', 'Event-Driven', 'Unwanted-Behavior', 'Optional-Feature', 'Complex'];

  function compileFullText(req) {
    const system = (req.system_name || '').trim() || 'The system';
    const responses = (req.responses || []).filter(Boolean).join(' and ');
    switch (req.pattern_type) {
      case 'State-Driven': {
        const conds = (req.preconditions || []).filter(Boolean).join(' and ');
        return 'While ' + (conds || '...') + ', ' + system + ' ' + (responses || 'shall [...]') + '.';
      }
      case 'Event-Driven':
        return 'When ' + (req.trigger || '...') + ', ' + system + ' ' + (responses || 'shall [...]') + '.';
      case 'Unwanted-Behavior':
        return 'If ' + (req.unwanted_condition || '...') + ', then ' + system + ' ' + (responses || 'shall [...]') + '.';
      case 'Optional-Feature':
        return 'Where ' + (req.feature_trigger || '...') + ', ' + system + ' ' + (responses || 'shall [...]') + '.';
      default:
        return system + ' ' + (responses || 'shall [...]') + '.';
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function patternOptions(selected) {
    return PATTERN_TYPES.map(p =>
      '<option value="' + p + '"' + (p === selected ? ' selected' : '') + '>' + p + '</option>'
    ).join('');
  }

  function conditionalFields(req, index) {
    const pt = req.pattern_type;
    let html = '';
    if (pt === 'State-Driven' || pt === 'Complex') {
      html += '<div class="field full-width">' +
        '<label>Preconditions (While&hellip;)</label>' +
        '<textarea rows="2" data-index="' + index + '" data-field="preconditions" placeholder="One precondition per line">' +
        escapeHtml((req.preconditions || []).join('\\n')) + '</textarea>' +
        '<span class="hint">One condition per line</span></div>';
    }
    if (pt === 'Event-Driven' || pt === 'Complex') {
      html += '<div class="field full-width">' +
        '<label>Trigger (When&hellip;)</label>' +
        '<input type="text" data-index="' + index + '" data-field="trigger" placeholder="the user submits the form" value="' +
        escapeHtml(req.trigger || '') + '" /></div>';
    }
    if (pt === 'Unwanted-Behavior' || pt === 'Complex') {
      html += '<div class="field full-width">' +
        '<label>Unwanted Condition (If&hellip;)</label>' +
        '<input type="text" data-index="' + index + '" data-field="unwanted_condition" placeholder="an invalid token is provided" value="' +
        escapeHtml(req.unwanted_condition || '') + '" /></div>';
    }
    if (pt === 'Optional-Feature' || pt === 'Complex') {
      html += '<div class="field full-width">' +
        '<label>Feature Trigger (Where&hellip;)</label>' +
        '<input type="text" data-index="' + index + '" data-field="feature_trigger" placeholder="dark mode is enabled" value="' +
        escapeHtml(req.feature_trigger || '') + '" /></div>';
    }
    return html;
  }

  function buildCardHtml(req, index) {
    const fullText = compileFullText(req);
    return '<div class="req-card" data-index="' + index + '">' +
      '<div class="req-card-header" data-toggle="' + index + '">' +
        '<span class="req-card-id">' + escapeHtml(req.id || 'NEW') + '</span>' +
        '<span class="req-card-pattern">' + escapeHtml(req.pattern_type || 'Ubiquitous') + '</span>' +
        '<span class="req-card-preview">' + escapeHtml(fullText) + '</span>' +
        '<span class="chevron">&#9654;</span>' +
      '</div>' +
      '<div class="req-card-body" id="req-body-' + index + '">' +
        '<div class="req-grid">' +
          '<div class="field">' +
            '<label>ID</label>' +
            '<input type="text" data-index="' + index + '" data-field="id" placeholder="REQ-101" value="' + escapeHtml(req.id || '') + '" spellcheck="false" />' +
          '</div>' +
          '<div class="field">' +
            '<label>Pattern Type</label>' +
            '<select data-index="' + index + '" data-field="pattern_type">' + patternOptions(req.pattern_type) + '</select>' +
          '</div>' +
          '<div class="field full-width">' +
            '<label>System Name</label>' +
            '<input type="text" data-index="' + index + '" data-field="system_name" placeholder="The authentication service" value="' + escapeHtml(req.system_name || '') + '" />' +
          '</div>' +
          conditionalFields(req, index) +
          '<div class="field full-width">' +
            '<label>Responses (shall&hellip;)</label>' +
            '<textarea rows="3" data-index="' + index + '" data-field="responses" placeholder="shall validate credentials&#10;shall return a token">' +
            escapeHtml((req.responses || []).join('\\n')) + '</textarea>' +
            '<span class="hint">One response per line (include &ldquo;shall&rdquo;)</span>' +
          '</div>' +
          '<div class="field full-width">' +
            '<label>Full Text (auto-compiled)</label>' +
            '<div class="full-text-preview" id="ft-' + index + '">' + escapeHtml(fullText) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="req-card-footer">' +
          '<button class="btn btn-danger" data-delete="' + index + '">Delete</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderList() {
    const list = document.getElementById('req-list');
    if (state.requirements.length === 0) {
      list.innerHTML = '<div class="empty-state">No requirements yet. Click &ldquo;+ Add Requirement&rdquo; to get started.</div>';
      return;
    }
    const openCards = new Set(
      [...document.querySelectorAll('.req-card-body.open')].map(el => Number(el.closest('.req-card').dataset.index))
    );
    list.innerHTML = state.requirements.map((req, i) => buildCardHtml(req, i)).join('');
    openCards.forEach(i => {
      const body = document.getElementById('req-body-' + i);
      if (body) {
        body.classList.add('open');
        const chevron = body.closest('.req-card').querySelector('.chevron');
        if (chevron) { chevron.classList.add('open'); }
      }
    });
    attachListeners();
  }

  function attachListeners() {
    document.querySelectorAll('[data-toggle]').forEach(header => {
      header.addEventListener('click', () => {
        const i = header.dataset.toggle;
        const body = document.getElementById('req-body-' + i);
        const chevron = header.querySelector('.chevron');
        body.classList.toggle('open');
        chevron.classList.toggle('open');
      });
    });

    const debounces = {};
    function debounced(key, fn, delay) {
      clearTimeout(debounces[key]);
      debounces[key] = setTimeout(fn, delay);
    }

    document.querySelectorAll('[data-index][data-field]').forEach(el => {
      const index = Number(el.dataset.index);
      const field = el.dataset.field;
      const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(eventType, e => {
        debounced('req-' + index + '-' + field, () => {
          vscode.postMessage({ type: 'editReq', index, field, value: e.target.value });
        }, 300);
        // update full_text preview immediately
        if (field === 'pattern_type') {
          state.requirements[index].pattern_type = e.target.value;
          // re-render this card to show/hide conditional fields
          const card = document.querySelector('.req-card[data-index="' + index + '"]');
          const wasOpen = document.getElementById('req-body-' + index).classList.contains('open');
          card.outerHTML = buildCardHtml(state.requirements[index], index);
          // re-attach after re-render
          attachListeners();
          if (wasOpen) {
            const body = document.getElementById('req-body-' + index);
            body.classList.add('open');
            document.querySelector('[data-toggle="' + index + '"] .chevron').classList.add('open');
          }
        } else {
          const req = state.requirements[index];
          if (field === 'responses' || field === 'preconditions') {
            req[field] = e.target.value.split('\\n').map(s => s.trim()).filter(Boolean);
          } else {
            req[field] = e.target.value;
          }
          const ft = compileFullText(req);
          const ftEl = document.getElementById('ft-' + index);
          if (ftEl) { ftEl.textContent = ft; }
          const preview = document.querySelector('.req-card[data-index="' + index + '"] .req-card-preview');
          if (preview) { preview.textContent = ft; }
        }
      });
    });

    document.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const index = Number(btn.dataset.delete);
        const reqId = state.requirements[index]?.id || 'this requirement';
        if (confirm('Delete ' + reqId + '?')) {
          vscode.postMessage({ type: 'deleteReq', index });
        }
      });
    });
  }

  // Metadata field listeners
  const metaDebounces = {};
  function metaDebounced(key, fn) {
    clearTimeout(metaDebounces[key]);
    metaDebounces[key] = setTimeout(fn, 300);
  }
  const idInput = document.getElementById('id-input');
  const lastReviewedByInput = document.getElementById('last-reviewed-by-input');
  const targetAudienceInput = document.getElementById('target-audience-input');

  idInput.addEventListener('input', e => metaDebounced('id', () => vscode.postMessage({ type: 'edit', key: 'id', value: e.target.value })));
  lastReviewedByInput.addEventListener('input', e => metaDebounced('lr', () => vscode.postMessage({ type: 'edit', key: 'lastReviewedBy', value: e.target.value })));
  targetAudienceInput.addEventListener('input', e => metaDebounced('ta', () => vscode.postMessage({ type: 'edit', key: 'targetAudience', value: e.target.value })));

  document.getElementById('add-req-btn').addEventListener('click', () => {
    vscode.postMessage({ type: 'addReq' });
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type !== 'update') { return; }
    state = msg.data;

    if (document.activeElement !== idInput) {
      idInput.value = state.id || '';
    }
    if (document.activeElement !== lastReviewedByInput) {
      lastReviewedByInput.value = (state.lastReviewedBy || []).join(', ');
    }
    if (document.activeElement !== targetAudienceInput) {
      targetAudienceInput.value = (state.targetAudience || []).join(', ');
    }

    renderList();
  });
</script>
</body>
</html>`;
	}
}
