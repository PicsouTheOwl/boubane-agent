#!/bin/bash
# ═══════════════════════════════════════════════════
# BOUBANE AGENT — One-shot installation script
# Usage: curl -sSL https://boubane.io/install | bash
#    or:  bash install.sh [OPTIONS]
# ═══════════════════════════════════════════════════

set -euo pipefail

# ─── Config ───
APP_NAME="boubane"
APP_DIR="/opt/${APP_NAME}"
DATA_DIR="/var/lib/${APP_NAME}"
LOG_DIR="/var/log/${APP_NAME}"
SERVICE_USER="boubane"
PORT="${BOUBANE_PORT:-3000}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BROWN='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; }
step()  { echo -e "\n${BROWN}── $* ──${NC}"; }

# ─── Pre-flight checks ───
preflight() {
  step "Vérification des prérequis"
  
  if [ "$(id -u)" -ne 0 ]; then
    error "Ce script doit être exécuté en root (sudo)"
    exit 1
  fi
  
  # Check Python 3.10+
  if ! command -v "$PYTHON_BIN" &>/dev/null; then
    error "Python 3 n'est pas installé"
    echo "  Install: sudo apt install python3 python3-pip python3-venv"
    exit 1
  fi
  
  PYTHON_VER=$($PYTHON_BIN -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
  info "Python ${PYTHON_VER} détecté"
  
  # Check available RAM (need at least 1GB)
  TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
  if [ "$TOTAL_RAM" -lt 1024 ]; then
    warn "RAM insuffisante (${TOTAL_RAM}Mo). Minimum 1Go recommandé."
  else
    info "RAM: ${TOTAL_RAM}Mo"
  fi
  
  # Check disk space (need at least 2GB)
  AVAIL_DISK=$(df -m / | awk 'NR==2{print $4}')
  if [ "$AVAIL_DISK" -lt 2048 ]; then
    warn "Espace disque insuffisant (${AVAIL_DISK}Mo). Minimum 2Go recommandé."
  else
    info "Espace disque: ${AVAIL_DISK}Mo disponibles"
  fi
}

# ─── Install system dependencies ───
install_deps() {
  step "Installation des dépendances système"
  
  apt-get update -qq
  
  # Core
  apt-get install -y -qq \
    python3-venv \
    python3-pip \
    curl \
    wget \
    git \
    nginx \
    sqlite3 \
    build-essential \
    libffi-dev \
    libssl-dev \
    tesseract-ocr \
    tesseract-ocr-fra \
    tesseract-ocr-eng \
    2>/dev/null
  
  info "Dépendances système installées"
}

# ─── Create user and directories ───
setup_dirs() {
  step "Création de l'utilisateur et des répertoires"
  
  if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
    info "Utilisateur ${SERVICE_USER} créé"
  else
    info "Utilisateur ${SERVICE_USER} existe déjà"
  fi
  
  mkdir -p "$APP_DIR" "$DATA_DIR"/{uploads,db,cache} "$LOG_DIR"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR" "$LOG_DIR"
  info "Répertoires créés: $APP_DIR, $DATA_DIR"
}

# ─── Install application ───
install_app() {
  step "Installation de Boubane Agent"
  
  # Clone or copy
  if [ -d "${APP_DIR}/.git" ]; then
    info "Mise à jour du code existant..."
    cd "$APP_DIR"
    git pull origin main 2>/dev/null || warn "Git pull échoué, on continue avec le code local"
  else
    # Copy from current directory if running from source
    if [ -f "$(dirname "$0")/app/main.py" ]; then
      cp -r "$(dirname "$0")/." "$APP_DIR/"
    else
      # Download from repo
      warn "Clonage depuis GitHub..."
      git clone https://github.com/PicsouTheOwl/boubane.git "$APP_DIR" 2>/dev/null || {
        error "Impossible de cloner le repo. Copiez manuellement les fichiers dans $APP_DIR"
        exit 1
      }
    fi
  fi
  
  # Create venv
  $PYTHON_BIN -m venv "${APP_DIR}/venv"
  source "${APP_DIR}/venv/bin/activate"
  
  # Install Python deps
  pip install --upgrade pip -q
  pip install -r "${APP_DIR}/requirements.txt" -q
  
  # Install Playwright browsers
  playwright install chromium 2>/dev/null || warn "Playwright chromium install failed (web browsing may not work)"
  
  deactivate
  info "Application installée dans $APP_DIR"
}

# ─── Create systemd service ───
setup_service() {
  step "Configuration du service systemd"
  
  cat > "/etc/systemd/system/${APP_NAME}.service" <<EOF
[Unit]
Description=Boubane Agent — IA locale
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
Environment=PATH=${APP_DIR}/venv/bin:/usr/local/bin:/usr/bin
Environment=PYTHONPATH=${APP_DIR}
Environment=BOUBANE_PORT=${PORT}
Environment=BOUBANE_DATA_DIR=${DATA_DIR}
ExecStart=${APP_DIR}/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1
Restart=always
RestartSec=5
StandardOutput=append:${LOG_DIR}/boubane.log
StandardError=append:${LOG_DIR}/boubane-error.log

# Security
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${DATA_DIR} ${LOG_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$APP_NAME"
  systemctl start "$APP_NAME"
  
  # Wait for startup
  sleep 3
  
  if systemctl is-active --quiet "$APP_NAME"; then
    info "Service ${APP_NAME} démarré et activé"
  else
    warn "Le service n'a pas démarré. Vérifiez: journalctl -u ${APP_NAME}"
  fi
}

# ─── Configure Nginx ───
setup_nginx() {
  step "Configuration Nginx"
  
  # Remove default site
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null
  
  cat > "/etc/nginx/sites-available/${APP_NAME}" <<'EOF'
server {
    listen 80;
    server_name _;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    
    # Max upload size
    client_max_body_size 50M;
    
    location / {
        proxy_pass http://127.0.0.1:BOUBANE_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
EOF

  # Replace port placeholder
  sed -i "s/BOUBANE_PORT/${PORT}/g" "/etc/nginx/sites-available/${APP_NAME}"
  
  ln -sf "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
  
  nginx -t 2>/dev/null && systemctl reload nginx || warn "Nginx config test failed"
  info "Nginx configuré (port 80 → ${PORT})"
}

# ─── Create .env file ───
create_env() {
  step "Création du fichier de configuration"
  
  if [ ! -f "${APP_DIR}/.env" ]; then
    cat > "${APP_DIR}/.env" <<EOF
# Boubane Agent Configuration
PORT=${PORT}
UPLOAD_DIR=${DATA_DIR}/uploads
DB_DIR=${DATA_DIR}/db
CACHE_DIR=${DATA_DIR}/cache

# Email (optionnel — configurez via le dashboard)
# IMAP_HOST=imap.gmail.com
# IMAP_PORT=993
# IMAP_USER=votre@gmail.com
# IMAP_PASS=app-password
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587

# Local LLM (optionnel — chemin vers un modèle GGUF)
# MODEL_PATH=/path/to/model.gguf
EOF
    chown "$SERVICE_USER:$SERVICE_USER" "${APP_DIR}/.env"
    info "Fichier .env créé"
  else
    info ".env existe déjà — non modifié"
  fi
}

# ─── Firewall ───
setup_firewall() {
  step "Configuration du firewall"
  
  if command -v ufw &>/dev/null; then
    ufw allow 80/tcp comment "Boubane Dashboard" 2>/dev/null || true
    ufw allow 443/tcp comment "Boubane Dashboard SSL" 2>/dev/null || true
    info "Règles UFW ajoutées"
  elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-service=http 2>/dev/null || true
    firewall-cmd --reload 2>/dev/null || true
    info "Règles firewalld ajoutées"
  else
    warn "Aucun firewall détecté — assurez-vous que le port 80 est ouvert"
  fi
}

# ─── Summary ───
summary() {
  echo ""
  echo -e "${BROWN}════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  BOUBANE AGENT — Installation terminée${NC}"
  echo -e "${BROWN}════════════════════════════════════════════${NC}"
  echo ""
  
  # Get IP
  LOCAL_IP=$(hostname -I | awk '{print $1}')
  PUBLIC_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo "N/A")
  
  echo -e "  📍 Accès local:    http://${LOCAL_IP}"
  echo -e "  🌐 Accès public:   http://${PUBLIC_IP}"
  echo -e "  📁 Code:           ${APP_DIR}"
  echo -e "  💾 Données:        ${DATA_DIR}"
  echo -e "  📋 Logs:           ${LOG_DIR}"
  echo ""
  echo -e "  Commandes utiles:"
  echo -e "    sudo systemctl status ${APP_NAME}    — statut"
  echo -e "    sudo systemctl restart ${APP_NAME}   — redémarrer"
  echo -e "    sudo journalctl -u ${APP_NAME} -f    — logs en direct"
  echo ""
  echo -e "  Ouvrez votre navigateur et commencez à utiliser Boubane !"
  echo ""
}

# ─── Main ───
main() {
  echo -e "${BROWN}"
  echo "  ╔═══════════════════════════════════════╗"
  echo "  ║   BOUBANE AGENT — Installation       ║"
  echo "  ║   Votre IA locale, vos données       ║"
  echo "  ╚═══════════════════════════════════════╝"
  echo -e "${NC}"
  
  preflight
  install_deps
  setup_dirs
  install_app
  create_env
  setup_service
  setup_nginx
  setup_firewall
  summary
}

main "$@"
