#!/bin/bash
# Cursor agent hook: logs events to .spectacles/logs/
# Install location: .cursor/hooks/spectacles-logger.sh
# Hooks into: sessionStart, afterAgentResponse, afterAgentThought, postToolUse, stop

set -euo pipefail

LOG_DIR=".spectacles/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || true

if ! command -v python3 >/dev/null 2>&1; then
    echo '{}'
    exit 0
fi

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT
cat > "$TMPFILE"

export SPECTACLES_HOOK_INPUT="$TMPFILE"
export SPECTACLES_LOG_DIR="$LOG_DIR"

python3 <<'PYEOF'
import sys, json, os
from datetime import datetime, timezone

log_dir = os.environ.get('SPECTACLES_LOG_DIR', '.spectacles/logs')
active_file = os.path.join(log_dir, 'active-session.json')
input_file = os.environ.get('SPECTACLES_HOOK_INPUT', '')

try:
    with open(input_file) as f:
        data = json.load(f)
except Exception:
    print('{}')
    sys.exit(0)

event_type = data.get('type', data.get('event', 'unknown'))
session_id = data.get('session_id', data.get('sessionId', ''))
ts = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def get_active():
    try:
        with open(active_file) as f:
            return json.load(f)
    except Exception:
        return None


def write_active(obj):
    with open(active_file, 'w') as f:
        json.dump(obj, f)


def append_log(log_file, entry):
    path = os.path.join(log_dir, log_file)
    with open(path, 'a') as f:
        f.write(json.dumps(entry) + '\n')


if event_type == 'sessionStart':
    ts_file = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')
    short_id = session_id[:8] if session_id else 'noid'
    log_file = f'{ts_file}-{short_id}.jsonl'
    append_log(log_file, {'ts': ts, 'event': 'session_start', 'sessionId': session_id})
    write_active({
        'sessionId': session_id,
        'logFile': log_file,
        'startedAt': ts,
        'status': 'active',
    })

elif event_type in ('afterAgentResponse', 'afterAgentThought'):
    active = get_active()
    if active and active.get('status') == 'active':
        log_file = active.get('logFile', '')
        if log_file:
            text = (
                data.get('response')
                or data.get('thought')
                or data.get('text')
                or data.get('content')
                or data.get('message')
                or ''
            )
            if isinstance(text, str):
                text = text[:2000]
            event_name = 'agent_response' if event_type == 'afterAgentResponse' else 'agent_thought'
            append_log(log_file, {'ts': ts, 'event': event_name, 'text': text})

elif event_type == 'postToolUse':
    active = get_active()
    if active and active.get('status') == 'active':
        log_file = active.get('logFile', '')
        if log_file:
            tool = data.get('tool', data.get('toolName', ''))
            tool_input = data.get('input', data.get('tool_input', {})) or {}
            label = tool
            if isinstance(tool_input, dict):
                path = tool_input.get('path', tool_input.get('file_path', tool_input.get('command', '')))
                if path:
                    label = f'{tool}: {str(path)[:120]}'
            append_log(log_file, {'ts': ts, 'event': 'tool_use', 'tool': tool, 'label': label})

elif event_type == 'stop':
    active = get_active()
    if active:
        log_file = active.get('logFile', '')
        if log_file:
            append_log(log_file, {'ts': ts, 'event': 'session_end', 'sessionId': session_id})
        active['status'] = 'complete'
        active['endedAt'] = ts
        write_active(active)

print('{}')
PYEOF
