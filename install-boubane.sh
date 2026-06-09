#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/ubuntu/boubane-agent"
APP_PORT="3001"

echo "==> Boubane one-click installer"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python3 manquant"; exit 1
fi
if ! command -v uvicorn >/dev/null 2>&1 && ! python3 - <<'PY'
import importlib.util as u
print('ok' if u.find_spec('uvicorn') else 'missing')
PY
then
  echo "UVicorn manquant"; exit 1
fi

mkdir -p "${APP_DIR}/data/uploads" "${APP_DIR}/data/db" "${APP_DIR}/data/cache"

cd "${APP_DIR}"

if [ ! -d venv ]; then
  python3 -m venv venv
fi
source venv/bin/activate
python -m pip install --upgrade pip >/dev/null 2>&1 || true
pip install -r requirements.txt -q

cat > /etc/systemd/system/boubane.service <<EOF
[Unit]
Description=Boubane Agent
After=network.target
[Service]
Type=simple
User=ubuntu
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port ${APP_PORT} --workers 1
Restart=always
RestartSec=2
Environment=HOME=/home/ubuntu
Environment=PATH=${APP_DIR}/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable boubane >/dev/null 2>&1 || true
systemctl restart boubane

echo "==> Health check"
sleep 2
STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:${APP_PORT}/health" || true)
if [ "$STATUS" != "200" ]; then
  echo "Health failed: $STATUS"
  exit 1
fi

echo "==> Boubane pret"
echo "Dashboard : http://127.0.0.1:${APP_PORT}/"
echo "Public     : http://$(curl -s ifconfig.me)/boubane/"
echo "Relancer   : sudo systemctl restart boubane"
