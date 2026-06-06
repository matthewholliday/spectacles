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
  input, select {
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
  input::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }
  input:focus, select:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: -1px;
  }
  select option { background: var(--vscode-dropdown-background, #1e1e1e); }
  .hint {
    font-size: 0.78em;
    opacity: 0.45;
  }

  /* Item list (replaces textareas for array fields) */
  .item-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .item-list-empty {
    font-size: 0.82em;
    opacity: 0.38;
    font-style: italic;
    padding: 3px 2px;
  }
  .item-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .item-row input {
    flex: 1;
    min-width: 0;
  }
  .btn-icon {
    background: transparent;
    border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
    color: var(--vscode-foreground);
    border-radius: 2px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 1em;
    line-height: 1;
    flex-shrink: 0;
    padding: 0;
    opacity: 0.55;
  }
  .btn-icon:hover { opacity: 1; background: rgba(128,128,128,0.15); }
  .btn-add-item {
    background: transparent;
    border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.4));
    color: var(--vscode-foreground);
    border-radius: 2px;
    padding: 4px 10px;
    font-family: inherit;
    font-size: 0.82em;
    cursor: pointer;
    text-align: left;
    opacity: 0.5;
    width: 100%;
  }
  .btn-add-item:hover { opacity: 1; background: rgba(128,128,128,0.08); }

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

  const ITEM_PLACEHOLDER = {
    responses: 'shall \u2026',
    preconditions: 'e.g. the user is authenticated',
  };

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
    return PATTERN_TYPES.map(function(p) {
      return '<option value="' + p + '"' + (p === selected ? ' selected' : '') + '>' + p + '</option>';
    }).join('');
  }

  // Builds an inline list of individually-editable items for array fields.
  function buildItemList(items, reqIndex, field) {
    const arr = items || [];
    const placeholder = ITEM_PLACEHOLDER[field] || '';
    let html = '<div class="item-list" data-req-index="' + reqIndex + '" data-field="' + field + '">';
    if (arr.length === 0) {
      html += '<span class="item-list-empty">None yet</span>';
    }
    for (let i = 0; i < arr.length; i++) {
      html +=
        '<div class="item-row">' +
          '<input type="text" class="item-input"' +
            ' data-req-index="' + reqIndex + '"' +
            ' data-field="' + field + '"' +
            ' data-item-idx="' + i + '"' +
            ' value="' + escapeHtml(arr[i]) + '"' +
            ' placeholder="' + escapeHtml(placeholder) + '" />' +
          '<button class="btn-icon btn-delete-item"' +
            ' data-req-index="' + reqIndex + '"' +
            ' data-field="' + field + '"' +
            ' data-item-idx="' + i + '"' +
            ' title="Remove">\u00D7</button>' +
        '</div>';
    }
    html +=
      '<button class="btn-add-item"' +
        ' data-req-index="' + reqIndex + '"' +
        ' data-field="' + field + '">+ Add</button>' +
      '</div>';
    return html;
  }

  function conditionalFields(req, index) {
    const pt = req.pattern_type;
    let html = '';
    if (pt === 'State-Driven' || pt === 'Complex') {
      html +=
        '<div class="field full-width">' +
          '<label>Preconditions (While\u2026)</label>' +
          buildItemList(req.preconditions || [], index, 'preconditions') +
        '</div>';
    }
    if (pt === 'Event-Driven' || pt === 'Complex') {
      html +=
        '<div class="field full-width">' +
          '<label>Trigger (When\u2026)</label>' +
          '<input type="text" data-index="' + index + '" data-field="trigger"' +
            ' placeholder="the user submits the form"' +
            ' value="' + escapeHtml(req.trigger || '') + '" />' +
        '</div>';
    }
    if (pt === 'Unwanted-Behavior' || pt === 'Complex') {
      html +=
        '<div class="field full-width">' +
          '<label>Unwanted Condition (If\u2026)</label>' +
          '<input type="text" data-index="' + index + '" data-field="unwanted_condition"' +
            ' placeholder="an invalid token is provided"' +
            ' value="' + escapeHtml(req.unwanted_condition || '') + '" />' +
        '</div>';
    }
    if (pt === 'Optional-Feature' || pt === 'Complex') {
      html +=
        '<div class="field full-width">' +
          '<label>Feature Trigger (Where\u2026)</label>' +
          '<input type="text" data-index="' + index + '" data-field="feature_trigger"' +
            ' placeholder="dark mode is enabled"' +
            ' value="' + escapeHtml(req.feature_trigger || '') + '" />' +
        '</div>';
    }
    return html;
  }

  function buildCardHtml(req, index) {
    const fullText = compileFullText(req);
    return (
      '<div class="req-card" data-index="' + index + '">' +
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
              '<input type="text" data-index="' + index + '" data-field="id"' +
                ' placeholder="REQ-101" spellcheck="false"' +
                ' value="' + escapeHtml(req.id || '') + '" />' +
            '</div>' +
            '<div class="field">' +
              '<label>Pattern Type</label>' +
              '<select data-index="' + index + '" data-field="pattern_type">' +
                patternOptions(req.pattern_type) +
              '</select>' +
            '</div>' +
            '<div class="field full-width">' +
              '<label>System Name</label>' +
              '<input type="text" data-index="' + index + '" data-field="system_name"' +
                ' placeholder="The authentication service"' +
                ' value="' + escapeHtml(req.system_name || '') + '" />' +
            '</div>' +
            conditionalFields(req, index) +
            '<div class="field full-width">' +
              '<label>Responses (shall\u2026)</label>' +
              buildItemList(req.responses || [], index, 'responses') +
              '<span class="hint">Include \u201Cshall\u201D in each response</span>' +
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
      '</div>'
    );
  }

  function updatePreviews(reqIndex) {
    const ft = compileFullText(state.requirements[reqIndex]);
    const ftEl = document.getElementById('ft-' + reqIndex);
    if (ftEl) { ftEl.textContent = ft; }
    const preview = document.querySelector('.req-card[data-index="' + reqIndex + '"] .req-card-preview');
    if (preview) { preview.textContent = ft; }
  }

  function renderList() {
    const list = document.getElementById('req-list');
    if (state.requirements.length === 0) {
      list.innerHTML = '<div class="empty-state">No requirements yet. Click \u201C+ Add Requirement\u201D to get started.</div>';
      return;
    }
    const openCards = new Set(
      Array.from(document.querySelectorAll('.req-card-body.open')).map(function(el) {
        return Number(el.closest('.req-card').dataset.index);
      })
    );
    list.innerHTML = state.requirements.map(function(req, i) { return buildCardHtml(req, i); }).join('');
    openCards.forEach(function(i) {
      const body = document.getElementById('req-body-' + i);
      if (body) {
        body.classList.add('open');
        const chevron = body.closest('.req-card').querySelector('.chevron');
        if (chevron) { chevron.classList.add('open'); }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Delegated event handling on #req-list (no per-element re-attachment needed)
  // ---------------------------------------------------------------------------

  const reqList = document.getElementById('req-list');
  const debounces = {};

  function debounced(key, fn, delay) {
    clearTimeout(debounces[key]);
    debounces[key] = setTimeout(fn, delay);
  }

  reqList.addEventListener('click', function(e) {
    // Delete item from array field
    const deleteItemBtn = e.target.closest('.btn-delete-item');
    if (deleteItemBtn) {
      e.stopPropagation();
      const reqIndex = Number(deleteItemBtn.dataset.reqIndex);
      const field = deleteItemBtn.dataset.field;
      const itemIdx = Number(deleteItemBtn.dataset.itemIdx);
      const arr = (state.requirements[reqIndex][field] || []).slice();
      arr.splice(itemIdx, 1);
      state.requirements[reqIndex][field] = arr;
      const oldList = deleteItemBtn.closest('.item-list');
      const tmp = document.createElement('div');
      tmp.innerHTML = buildItemList(arr, reqIndex, field);
      oldList.replaceWith(tmp.firstChild);
      updatePreviews(reqIndex);
      vscode.postMessage({ type: 'editReq', index: reqIndex, field: field, value: arr.join('\\n') });
      return;
    }

    // Add item to array field
    const addItemBtn = e.target.closest('.btn-add-item');
    if (addItemBtn) {
      e.stopPropagation();
      const reqIndex = Number(addItemBtn.dataset.reqIndex);
      const field = addItemBtn.dataset.field;
      if (!state.requirements[reqIndex][field]) { state.requirements[reqIndex][field] = []; }
      state.requirements[reqIndex][field].push('');
      const arr = state.requirements[reqIndex][field];
      const oldList = addItemBtn.closest('.item-list');
      const tmp = document.createElement('div');
      tmp.innerHTML = buildItemList(arr, reqIndex, field);
      oldList.replaceWith(tmp.firstChild);
      const inputs = document.querySelectorAll(
        '.item-input[data-req-index="' + reqIndex + '"][data-field="' + field + '"]'
      );
      if (inputs.length > 0) { inputs[inputs.length - 1].focus(); }
      return;
    }

    // Delete requirement
    const deleteReqBtn = e.target.closest('[data-delete]');
    if (deleteReqBtn) {
      e.stopPropagation();
      const index = Number(deleteReqBtn.dataset.delete);
      const reqId = (state.requirements[index] && state.requirements[index].id) || 'this requirement';
      if (confirm('Delete ' + reqId + '?')) {
        vscode.postMessage({ type: 'deleteReq', index: index });
      }
      return;
    }

    // Toggle accordion
    const toggleHeader = e.target.closest('[data-toggle]');
    if (toggleHeader) {
      const i = toggleHeader.dataset.toggle;
      const body = document.getElementById('req-body-' + i);
      const chevron = toggleHeader.querySelector('.chevron');
      if (body) { body.classList.toggle('open'); }
      if (chevron) { chevron.classList.toggle('open'); }
    }
  });

  reqList.addEventListener('input', function(e) {
    // Array field item edit
    const itemInput = e.target.closest('.item-input');
    if (itemInput) {
      const reqIndex = Number(itemInput.dataset.reqIndex);
      const field = itemInput.dataset.field;
      const allInputs = Array.from(document.querySelectorAll(
        '.item-input[data-req-index="' + reqIndex + '"][data-field="' + field + '"]'
      ));
      const values = allInputs.map(function(el) { return el.value; });
      state.requirements[reqIndex][field] = values.filter(Boolean);
      updatePreviews(reqIndex);
      debounced('item-' + reqIndex + '-' + field, function() {
        vscode.postMessage({ type: 'editReq', index: reqIndex, field: field, value: values.filter(Boolean).join('\\n') });
      }, 300);
      return;
    }

    // Scalar field edit
    const fieldEl = e.target.closest('[data-index][data-field]');
    if (fieldEl) {
      const index = Number(fieldEl.dataset.index);
      const field = fieldEl.dataset.field;
      const value = e.target.value;
      state.requirements[index][field] = value;
      updatePreviews(index);
      debounced('req-' + index + '-' + field, function() {
        vscode.postMessage({ type: 'editReq', index: index, field: field, value: value });
      }, 300);
    }
  });

  reqList.addEventListener('change', function(e) {
    const selectEl = e.target.closest('select[data-index][data-field]');
    if (!selectEl) { return; }
    const index = Number(selectEl.dataset.index);
    const field = selectEl.dataset.field;
    const value = e.target.value;

    state.requirements[index][field] = value;

    if (field === 'pattern_type') {
      const card = document.querySelector('.req-card[data-index="' + index + '"]');
      const wasOpen = document.getElementById('req-body-' + index).classList.contains('open');
      const tmp = document.createElement('div');
      tmp.innerHTML = buildCardHtml(state.requirements[index], index);
      card.replaceWith(tmp.firstChild);
      if (wasOpen) {
        const body = document.getElementById('req-body-' + index);
        if (body) { body.classList.add('open'); }
        const chevron = document.querySelector('[data-toggle="' + index + '"] .chevron');
        if (chevron) { chevron.classList.add('open'); }
      }
    }

    updatePreviews(index);
    debounced('req-' + index + '-' + field, function() {
      vscode.postMessage({ type: 'editReq', index: index, field: field, value: value });
    }, 300);
  });

  // ---------------------------------------------------------------------------
  // Metadata field listeners
  // ---------------------------------------------------------------------------

  const metaDebounces = {};
  function metaDebounced(key, fn) {
    clearTimeout(metaDebounces[key]);
    metaDebounces[key] = setTimeout(fn, 300);
  }

  const idInput = document.getElementById('id-input');
  const lastReviewedByInput = document.getElementById('last-reviewed-by-input');
  const targetAudienceInput = document.getElementById('target-audience-input');

  idInput.addEventListener('input', function(e) {
    metaDebounced('id', function() { vscode.postMessage({ type: 'edit', key: 'id', value: e.target.value }); });
  });
  lastReviewedByInput.addEventListener('input', function(e) {
    metaDebounced('lr', function() { vscode.postMessage({ type: 'edit', key: 'lastReviewedBy', value: e.target.value }); });
  });
  targetAudienceInput.addEventListener('input', function(e) {
    metaDebounced('ta', function() { vscode.postMessage({ type: 'edit', key: 'targetAudience', value: e.target.value }); });
  });

  document.getElementById('add-req-btn').addEventListener('click', function() {
    vscode.postMessage({ type: 'addReq' });
  });

  window.addEventListener('message', function(event) {
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
