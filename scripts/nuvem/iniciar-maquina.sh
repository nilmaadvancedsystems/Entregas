#!/bin/bash
# Prepara a máquina do Google onde o robô roda (e2-micro, faixa gratuita).
#
# O Google executa este arquivo como root a cada vez que a máquina liga. Ele
# pode rodar quantas vezes for: o que já está feito, fica como está.
#
# O que ele faz:
#   1. cria o usuário "robo" (o robô não roda como root);
#   2. instala o Node na mesma versão do PC do escritório;
#   3. baixa o código do GitHub e instala as dependências;
#   4. na primeira vez, grava as credenciais que vieram nos metadados da
#      máquina (segredo-*) — depois disso elas são apagadas de lá e ficam só
#      no disco, legíveis apenas pelo usuário "robo";
#   5. registra o robô como serviço do sistema, que religa sozinho se cair;
#   6. liga um "interruptor" que confere os metadados a cada minuto:
#        robo-ligado = sim      liga o robô; qualquer outra coisa, desliga
#        robo-versao = (texto)  quando muda, baixa o código novo e reinicia
#      É assim que o robô é ligado, desligado e atualizado sem ninguém
#      precisar entrar na máquina.
#
# Nada aqui é segredo: as credenciais chegam pelos metadados, nunca por este
# arquivo, que está no repositório público.
set -u
NODE_VERSAO=v24.18.0
BASE=/opt/robo
REPO=https://github.com/nilmaadvancedsystems/Entregas.git
META=http://metadata.google.internal/computeMetadata/v1/instance/attributes
meta() { curl -sf -H 'Metadata-Flavor: Google' "$META/$1"; }

id robo >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/robo --shell /usr/sbin/nologin robo
mkdir -p "$BASE/backup/banco"

# 1 GB de memória é pouco pra instalar dependência; a troca em disco evita
# que a instalação morra no meio.
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

command -v git >/dev/null || { apt-get update -q && apt-get install -y -q git; }

if [ ! -x /opt/node/bin/node ] || [ "$(/opt/node/bin/node -v)" != "$NODE_VERSAO" ]; then
  curl -sfL "https://nodejs.org/dist/$NODE_VERSAO/node-$NODE_VERSAO-linux-x64.tar.xz" -o /tmp/node.tar.xz
  rm -rf /opt/node && mkdir -p /opt/node
  tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1 && rm -f /tmp/node.tar.xz
fi
export PATH=/opt/node/bin:$PATH

if [ ! -d "$BASE/Entregas/.git" ]; then
  git clone -q --depth 50 "$REPO" "$BASE/Entregas"
fi
chown -R robo:robo "$BASE"
SCRIPTS="$BASE/Entregas/scripts"
if [ ! -d "$SCRIPTS/node_modules" ]; then
  sudo -u robo env PATH="$PATH" npm ci --omit=dev --no-audit --no-fund --prefix "$SCRIPTS" >/dev/null 2>&1 \
    || sudo -u robo env PATH="$PATH" npm install --omit=dev --no-audit --no-fund --prefix "$SCRIPTS" >/dev/null 2>&1
fi

# Credenciais: só gravadas se ainda não existem no disco.
gravar_segredo() {   # $1 = chave nos metadados, $2 = arquivo
  local destino="$SCRIPTS/$2"
  [ -s "$destino" ] && return
  local valor; valor=$(meta "$1") || return
  [ -n "$valor" ] || return
  umask 077; printf '%s' "$valor" > "$destino"; chown robo:robo "$destino"; chmod 600 "$destino"
}
gravar_segredo segredo-gmail-cliente gmail_oauth_client.json
gravar_segredo segredo-gmail-token   gmail_token.json
gravar_segredo segredo-gemini        gemini_key.json

cat > /etc/systemd/system/robo.service <<EOF
[Unit]
Description=Robo do Gmail - Nilma Contabilidade
After=network-online.target
Wants=network-online.target

[Service]
User=robo
WorkingDirectory=$SCRIPTS
Environment=PATH=/opt/node/bin:/usr/bin:/bin
Environment=TZ=America/Sao_Paulo
Environment=ROBO_NA_NUVEM=1
Environment=ROBO_NOME=nuvem-google
Environment=USAR_DRIVE_API=1
Environment=BACKUP_PASTA=$BASE/backup/banco
ExecStart=/opt/node/bin/node vigia-robo.js --a-cada 120
Restart=always
RestartSec=30
# O registro vai também pra porta serial, que dá pra ler de fora pela API do
# Google sem entrar na máquina.
StandardOutput=journal+console
StandardError=journal+console
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
EOF

cat > /usr/local/bin/robo-interruptor <<'EOF'
#!/bin/bash
META=http://metadata.google.internal/computeMetadata/v1/instance/attributes
meta() { curl -sf -H 'Metadata-Flavor: Google' "$META/$1"; }
SCRIPTS=/opt/robo/Entregas/scripts
export PATH=/opt/node/bin:$PATH
ligado=$(meta robo-ligado)
versao=$(meta robo-versao)
if [ -n "$versao" ] && [ "$versao" != "$(cat /opt/robo/versao 2>/dev/null)" ]; then
  echo "robo-interruptor: atualizando para $versao" > /dev/console
  sudo -u robo git -C /opt/robo/Entregas pull -q --ff-only \
    && sudo -u robo env PATH="$PATH" npm install --omit=dev --no-audit --no-fund --prefix "$SCRIPTS" >/dev/null 2>&1 \
    && echo "$versao" > /opt/robo/versao \
    && { [ "$ligado" = "sim" ] && systemctl restart robo; true; }
fi
if [ "$ligado" = "sim" ]; then
  systemctl is-active -q robo || { echo "robo-interruptor: ligando" > /dev/console; systemctl start robo; }
else
  systemctl is-active -q robo && { echo "robo-interruptor: desligando" > /dev/console; systemctl stop robo; }
fi
exit 0
EOF
chmod 755 /usr/local/bin/robo-interruptor

cat > /etc/systemd/system/robo-interruptor.service <<'EOF'
[Unit]
Description=Confere nos metadados se o robo deve estar ligado
[Service]
Type=oneshot
ExecStart=/usr/local/bin/robo-interruptor
EOF
cat > /etc/systemd/system/robo-interruptor.timer <<'EOF'
[Unit]
Description=Interruptor do robo, a cada minuto
[Timer]
OnBootSec=30
OnUnitActiveSec=60
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
# O robô não liga sozinho na partida da máquina: quem decide é o interruptor.
systemctl disable -q robo 2>/dev/null
systemctl enable -q --now robo-interruptor.timer
echo "iniciar-maquina: pronto ($(date -Is))" > /dev/console
