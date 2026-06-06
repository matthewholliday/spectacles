import * as vscode from 'vscode';
import {
	agentActionCss,
	agentActionHtml,
	agentActionJs,
	runAgentAction,
	resolveLayoutUri,
	getWorkspaceRootUri,
	type PostFn,
} from './agentActionComponent';

const DRAFT_TARGET = 'dft';

let panel: vscode.WebviewPanel | undefined;

export function openNewSpecWebview(context: vscode.ExtensionContext): void {
	if (panel) {
		panel.reveal(vscode.ViewColumn.One);
		return;
	}

	panel = vscode.window.createWebviewPanel(
		'spectacles.newSpec',
		'New Specification',
		vscode.ViewColumn.One,
		{ enableScripts: true }
	);

	panel.webview.html = buildHtml();

	const postToPanel: PostFn = (command, payload) =>
		panel?.webview.postMessage({ command, ...payload });

	panel.webview.onDidReceiveMessage(async (message) => {
		if (message.command === 'draft') {
			const root = getWorkspaceRootUri();
			if (!root) {
				vscode.window.showErrorMessage('Open a folder/workspace first.');
				return;
			}

			const { name, description, version, targetAudience, authors } = message;

			const promptSuffix = JSON.stringify(
				{
					workspaceRoot: root.fsPath,
					name,
					description: description ?? '',
					version: version || '0.1.0',
					targetAudience: typeof targetAudience === 'string'
						? targetAudience.split(',').map((s: string) => s.trim()).filter(Boolean)
						: (targetAudience ?? []),
					authors: typeof authors === 'string'
						? authors.split(',').map((s: string) => s.trim()).filter(Boolean)
						: (authors ?? []),
				},
				null,
				2
			);

			const agentUri = resolveLayoutUri(root, '.cursor/agents/spectacles.draft.md');
			await runAgentAction({
				agentUri,
				promptSuffix,
				post: postToPanel,
				root,
				target: DRAFT_TARGET,
			});
		}
	}, null, context.subscriptions);

	panel.onDidDispose(() => {
		panel = undefined;
	}, null, context.subscriptions);
}

function buildHtml(): string {
	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <title>New Specification</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 32px 40px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      max-width: 680px;
    }

    h1 {
      margin: 0 0 6px;
      font-size: 1.4em;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .subtitle {
      margin: 0 0 28px;
      font-size: 0.88em;
      color: var(--vscode-descriptionForeground);
    }

    .form-group {
      margin-bottom: 20px;
    }

    label {
      display: block;
      font-size: 0.88em;
      font-weight: 600;
      margin-bottom: 5px;
      color: var(--vscode-foreground);
    }

    label .required {
      color: var(--vscode-inputValidation-errorBorder, #f44747);
      margin-left: 2px;
    }

    label .hint {
      font-weight: 400;
      color: var(--vscode-descriptionForeground);
      margin-left: 6px;
    }

    input[type="text"],
    textarea {
      width: 100%;
      padding: 6px 8px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      outline: none;
    }

    input[type="text"]:focus,
    textarea:focus {
      border-color: var(--vscode-focusBorder);
    }

    textarea {
      resize: vertical;
      min-height: 72px;
    }

    .field-description {
      margin-top: 4px;
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
    }

    .field-error {
      margin-top: 4px;
      font-size: 0.8em;
      color: var(--vscode-inputValidation-errorBorder, #f44747);
      display: none;
    }

    .divider {
      border: none;
      border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border));
      margin: 28px 0;
    }

    .section-label {
      font-size: 0.78em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--vscode-descriptionForeground);
      margin: 0 0 16px;
    }

    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 32px;
    }

    button {
      padding: 6px 16px;
      border-radius: 2px;
      border: 1px solid transparent;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      cursor: pointer;
      line-height: 1.4;
    }

    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-border, transparent);
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }

    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Hide the auto-generated agent action trigger button —
       the form submit button serves as the trigger instead. */
    #${DRAFT_TARGET}-trigger {
      display: none;
    }

    ${agentActionCss()}
  </style>
</head>
<body>
  <script>
    window.__vscodeApi = acquireVsCodeApi();
  </script>

  <h1>New Specification</h1>
  <p class="subtitle">Define the details for your new spec bundle. Fields marked <span style="color:var(--vscode-inputValidation-errorBorder,#f44747)">*</span> are required.</p>

  <div id="spec-form">
    <div class="form-group">
      <label for="name">Name <span class="required">*</span></label>
      <input type="text" id="name" placeholder="e.g. User Authentication" autocomplete="off" />
      <p class="field-error" id="name-error">Spec name is required.</p>
      <p class="field-description">Human-readable name for the specification. Used to generate the spec ID.</p>
    </div>

    <div class="form-group">
      <label for="description">Description <span class="hint">(optional)</span></label>
      <textarea id="description" placeholder="A short summary of what this spec covers..."></textarea>
    </div>

    <hr class="divider" />
    <p class="section-label">Metadata</p>

    <div class="two-col">
      <div class="form-group">
        <label for="version">Version</label>
        <input type="text" id="version" value="0.1.0" autocomplete="off" />
        <p class="field-description">Semantic version for this spec (e.g. 0.1.0).</p>
      </div>

      <div class="form-group">
        <label for="target-audience">Target Audience <span class="hint">(optional)</span></label>
        <input type="text" id="target-audience" placeholder="Product, Engineering" autocomplete="off" />
        <p class="field-description">Comma-separated list of intended readers.</p>
      </div>
    </div>

    <div class="form-group">
      <label for="authors">Authors <span class="hint">(optional)</span></label>
      <input type="text" id="authors" placeholder="Alice, Bob" autocomplete="off" />
      <p class="field-description">Comma-separated list of authors responsible for this spec.</p>
    </div>

    <div class="actions">
      <button class="btn-primary" id="submit">Create Specification</button>
    </div>
  </div>

  ${agentActionHtml({ buttonLabel: 'Create Specification', command: 'draft', id: DRAFT_TARGET })}
  ${agentActionJs({ command: 'draft', id: DRAFT_TARGET })}

  <script>
    (function() {
      var submitBtn = document.getElementById('submit');
      var nameInput = document.getElementById('name');
      var nameError = document.getElementById('name-error');

      submitBtn.addEventListener('click', function() {
        var name = nameInput.value.trim();

        if (!name) {
          nameError.style.display = 'block';
          nameInput.focus();
          return;
        }

        nameError.style.display = 'none';
        submitBtn.disabled = true;

        // Manually transition the agent action component to running state
        // (the trigger is hidden; this mirrors what dft_run() would do)
        var running = document.getElementById('${DRAFT_TARGET}-running');
        var logSection = document.getElementById('${DRAFT_TARGET}-log-section');
        if (running) { running.style.display = ''; }
        if (logSection) { logSection.classList.add('expanded'); }

        window.__vscodeApi.postMessage({
          command: 'draft',
          name: name,
          description: document.getElementById('description').value.trim(),
          version: document.getElementById('version').value.trim() || '0.1.0',
          targetAudience: document.getElementById('target-audience').value.trim(),
          authors: document.getElementById('authors').value.trim(),
        });
      });

      // Re-enable the submit button when the agent finishes
      // (appendLogs with isActive=false is the completion signal)
      var origAppend = window['${DRAFT_TARGET}_appendLogs'];
      window.addEventListener('message', function(ev) {
        var msg = ev.data;
        if (msg.target === '${DRAFT_TARGET}' && msg.command === 'appendLogs' && !msg.isActive) {
          submitBtn.disabled = false;
        }
      });
    })();
  </script>
</body>
</html>`;
}
