#!/usr/bin/env bash
#
# Vote Play — purga rastros de proveniência do HISTÓRICO do git.
#
# Victor Neves (voaneves.com)
#
# A árvore ATUAL já está limpa. Este script cuida dos commits antigos, onde
# ainda vivem:
#   • a palavra "lovable" nos arquivos do scaffold de 27/08/2025
#   • o bun.lockb daquele scaffold
#   • manifestos C2PA nos SVG (<metadata>) e nos PNG (chunk caBX)
#   • /Producer Skia/PDF e /Creator HeadlessChrome no PDF do brandkit
#   • o caminho /home/claude em brand/colors.py
#
# O que ele NÃO muda: seus 21 commits continuam 21, todos seus, com as mesmas
# mensagens e datas. Só os hashes mudam — e é por isso que exige force-push.
#
# Este script NÃO faz push. Ele para antes e te mostra o comando.
#
# Uso:  bash limpar-historico.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
echo "Repositório: $(pwd)"

# ---------------------------------------------------------------- 1. guardas
if [ -n "$(git status --porcelain)" ]; then
  echo
  echo "ERRO: há mudanças não commitadas."
  echo "O filter-repo reescreve commits; trabalho solto no meio disso se perde."
  echo "Faça o commit primeiro e rode de novo."
  exit 1
fi

if ! python3 -c "import git_filter_repo" 2>/dev/null && ! command -v git-filter-repo >/dev/null; then
  echo "Instalando git-filter-repo…"
  pip install --quiet git-filter-repo
fi
export PATH="$HOME/.local/bin:$PATH"

# ------------------------------------------------- 2. rede de segurança real
BACKUP="../vote-play-backup-$(date +%Y%m%d-%H%M%S).bundle"
git bundle create "$BACKUP" --all
echo "Backup COMPLETO do repositório em: $(cd .. && pwd)/$(basename "$BACKUP")"
echo "  (para voltar atrás: git clone <esse arquivo> vote-play-restaurado)"

ORIGIN="$(git remote get-url origin 2>/dev/null || echo '')"

# ------------------------------------------------------------ 3. as regras
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/substituicoes.txt" <<'EOF'
lovable-tagger==>vote-play
lovable==>vote-play
Lovable==>Vote Play
LOVABLE==>VOTE-PLAY
/home/claude/brand/palette.json==>palette.json
EOF

cat > "$TMP/corpo-blob.py" <<'EOF'
import re, struct
d = blob.data

if d[:8] == b"\x89PNG\r\n\x1a\n" and b"caBX" in d:
    saida, i = bytearray(d[:8]), 8
    while i < len(d) - 8:
        ln = struct.unpack(">I", d[i:i+4])[0]
        tipo = d[i+4:i+8]
        if tipo != b"caBX":
            saida += d[i:i+12+ln]
        i += 12 + ln
        if tipo == b"IEND":
            break
    blob.data = bytes(saida)

elif d[:4] == b"%PDF":
    def _pad(novo, alvo):
        novo = novo[:alvo]
        return novo + b" " * (alvo - len(novo))
    n = re.sub(rb"Skia/PDF m\d+", lambda m: _pad(b"Vote Play", len(m.group(0))), d)
    # dentro de string literal de PDF os parenteses vem escapados como \( e \),
    # entao casar "ate o proximo )" nao funciona: vai do Mozilla ao Safari/NNN.
    # O tamanho e preservado byte a byte: mudar quebraria a tabela xref.
    n = re.sub(rb"Mozilla/5\.0.{0,240}?Safari/[\d.]+",
               lambda m: _pad(b"Victor Neves (voaneves.com)", len(m.group(0))), n)
    if n != d:
        blob.data = n

elif b"<svg" in d[:400] and b"c2pa" in d:
    n = re.sub(rb"<metadata>\s*<c2pa:manifest>.*?</c2pa:manifest>\s*</metadata>", b"", d, flags=re.S)
    n = n.replace(b' xmlns:c2pa="http://c2pa.org/manifest"', b"")
    blob.data = n
EOF

# -------------------------------------------------------------- 4. reescrita
echo
echo "Reescrevendo o histórico…"
git filter-repo --force \
  --invert-paths --path bun.lockb \
  --replace-text "$TMP/substituicoes.txt" \
  --blob-callback "$(cat "$TMP/corpo-blob.py")"

# filter-repo remove o remoto de propósito, para você não dar push sem querer
if [ -n "$ORIGIN" ]; then
  git remote add origin "$ORIGIN"
  echo "Remoto 'origin' recolocado: $ORIGIN"
fi

# ------------------------------------------------------------ 5. verificação
echo
echo "Verificando todos os blobs de todos os commits…"
achou=0
while read -r o; do
  [ "$(git cat-file -t "$o" 2>/dev/null)" = "blob" ] || continue
  if git cat-file blob "$o" 2>/dev/null \
     | grep -aqE "lovable|Lovable|anthropic|Anthropic|c2pa:manifest|caBX|Skia/PDF|HeadlessChrome|Mozilla/5|/home/claude"; then
    echo "  AINDA TEM: $o"
    achou=1
  fi
done < <(git rev-list --objects --all | awk '{print $1}' | sort -u)

if [ "$achou" = "0" ]; then
  echo "  OK — nenhum rastro em nenhum commit."
else
  echo "  Algo sobrou. NÃO dê push; o backup acima tem o estado anterior."
  exit 1
fi

echo
echo "Autores no histórico:"
git log --all --format='  %an <%ae>' | sort -u

# --------------------------------------------------------------- 6. o push
cat <<FIM

------------------------------------------------------------------
Pronto localmente. O push é irreversível e é seu para dar:

    git push --force origin main

E para apagar o branch do ImgBot, que é o único commit de outro autor
no GitHub (ele nunca entrou na main):

    git push origin --delete imgbot

Quem já tiver clonado o repositório vai precisar de um clone novo.
------------------------------------------------------------------
FIM
