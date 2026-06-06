import * as vscode from 'vscode';

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

    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    }

    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.25));
    }

    .coming-soon {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
  </style>
</head>
<body>
  <h1>New Specification</h1>
  <p class="subtitle">Define the details for your new spec bundle. Fields marked <span style="color:var(--vscode-inputValidation-errorBorder,#f44747)">*</span> are required.</p>

  <div class="form-group">
    <label for="name">Name <span class="required">*</span></label>
    <input type="text" id="name" placeholder="e.g. User Authentication" autocomplete="off" />
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
    <span class="coming-soon">Submission not yet implemented.</span>
  </div>

  <script>
    (function() {
      // TODO: wire up submit to create spec files on disk
      document.getElementById('submit').addEventListener('click', function() {
        // no-op for now
      });
    })();
  </script>
</body>
</html>`;
}
