#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
npm --prefix frontend install

if ! command -v ollama >/dev/null 2>&1; then
	curl -fsSL https://ollama.com/install.sh | sh
fi

ollama_pid=''
backend_pid=''
cleanup() {
	if [[ -n "$backend_pid" ]]; then kill "$backend_pid" 2>/dev/null || true; fi
	if [[ -n "$ollama_pid" ]]; then kill "$ollama_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
	ollama serve >/tmp/cauce-ollama.log 2>&1 &
	ollama_pid=$!
	curl --fail --silent --show-error --retry 30 --retry-connrefused --retry-delay 1 --retry-max-time 30 http://127.0.0.1:11434/api/tags >/dev/null
fi

ollama pull llama3.1:8b

(cd backend && ../.venv/bin/python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000) &
backend_pid=$!

cd frontend
npm run dev -- --host 0.0.0.0
