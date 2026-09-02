# Backend do Nilma Entregas (PHP + MariaDB/MySQL)

Esses arquivos rodam na sua hospedagem (não no GitHub — o GitHub só serve o
`entregas.html`, que é estático). Passo a passo:

## 1. Criar o banco
No **cPanel → MySQL Databases**, crie um banco e um usuário com todas as
permissões nesse banco (anote nome do banco, usuário e senha — normalmente
vêm prefixados com o seu usuário do cPanel, ex.: `nilmacon_entregas`).

## 2. Criar as tabelas
No **cPanel → phpMyAdmin**, selecione o banco criado, vá na aba **SQL**,
cole o conteúdo de `schema.sql` e execute. Depois faça o mesmo com
`seed_clientes.sql` (importa os 315 clientes já cadastrados).

## 3. Enviar os arquivos PHP
No **cPanel → Gerenciador de Arquivos**, crie uma pasta (ex.: `api`) dentro
de `public_html` e envie todos os arquivos `.php` desta pasta pra lá.

## 4. Configurar
Edite `config.php` (pelo próprio editor do Gerenciador de Arquivos) e
preencha `$DB_HOST`, `$DB_NAME`, `$DB_USER`, `$DB_PASS` com os dados do
passo 1.

## 5. Testar a conexão
Abra `https://seudominio.com.br/api/status.php` no navegador. Deve
aparecer algo como `{"ok":true,"clientes":315,"usuarios":0}`.

## 6. Criar o primeiro login
Abra `https://seudominio.com.br/api/setup_usuario.php`, crie o(s)
usuário(s) da equipe (nome, e-mail, senha) e **depois apague esse arquivo
do servidor** — ele fica sem proteção própria.

## 7. Me avise a URL
Me diga a URL onde `api` ficou publicada (ex.:
`https://seudominio.com.br/api`) que eu termino de ligar o app do GitHub
nela.
