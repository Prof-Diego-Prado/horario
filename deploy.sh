#!/bin/bash
# ============================================================
#  WorkHub — Deploy to GitHub Pages
#  Requisitos: git instalado + conta GitHub
#  Uso: ./deploy.sh [nome-do-repo]
# ============================================================

set -e

REPO_NAME="${1:-workhub-dashboard}"
BRANCH="gh-pages"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "🚀 WorkHub — Deploy para GitHub Pages"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Verifica git
if ! command -v git &>/dev/null; then
  echo "❌ git não encontrado. Instale em: https://git-scm.com"
  exit 1
fi

cd "$DIR"

# 2. Inicia repo se necessário
if [ ! -d ".git" ]; then
  echo "📁 Inicializando repositório git..."
  git init
  git checkout -b main 2>/dev/null || git checkout -b master 2>/dev/null || true
fi

# 3. Configura remote
echo ""
read -p "🔗 URL do repositório GitHub (ex: https://github.com/usuario/${REPO_NAME}.git): " REMOTE_URL
if [ -z "$REMOTE_URL" ]; then
  echo "❌ URL não fornecida. Abortando."
  exit 1
fi

git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE_URL"

# 4. Commit & Push
echo ""
echo "📦 Preparando arquivos..."
git add -A
git commit -m "deploy: WorkHub Dashboard v2 — $(date '+%Y-%m-%d %H:%M')" 2>/dev/null || echo "Nada novo para commitar."

echo "📤 Enviando para GitHub..."
git push -u origin HEAD --force

# 5. Cria branch gh-pages se não existir
if ! git show-ref --quiet refs/heads/$BRANCH; then
  git checkout --orphan $BRANCH
  git add -A
  git commit -m "gh-pages: initial deploy"
  git push -u origin $BRANCH --force
  git checkout -
fi

git push origin HEAD:$BRANCH --force

echo ""
echo "✅ Deploy concluído!"
echo ""
echo "🌐 Seu dashboard estará disponível em alguns minutos em:"
GITHUB_USER=$(echo "$REMOTE_URL" | sed -E 's|https://github.com/([^/]+)/.*|\1|')
echo "   https://${GITHUB_USER}.github.io/${REPO_NAME}/"
echo ""
echo "⚙️  IMPORTANTE: Adicione essa URL como Origem Autorizada no Google Cloud Console:"
echo "   https://console.cloud.google.com/apis/credentials"
echo "   → Credenciais → Seu OAuth 2.0 Client ID → Origens JavaScript Autorizadas"
echo ""
