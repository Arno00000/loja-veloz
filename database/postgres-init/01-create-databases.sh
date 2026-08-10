#!/bin/bash
# =============================================================================
# Inicializacao do PostgreSQL da Loja Veloz.
#
# A imagem oficial do PostgreSQL executa todos os arquivos .sh e .sql em
# /docker-entrypoint-initdb.d NA PRIMEIRA subida do conteiner, quando o
# diretorio de dados esta vazio. Se o volume ja existir, este script NAO roda.
# Para reexecutar: docker compose down -v (apaga os dados) e suba novamente.
#
# O que este script faz:
#   1. cria os tres bancos, um por microsservico;
#   2. cria um usuario por microsservico;
#   3. concede a cada usuario permissao APENAS no seu proprio banco.
#
# Por que separar: mesmo compartilhando uma instancia por economia
# operacional no ambiente academico, cada servico so enxerga o seu banco. Um
# servico comprometido nao consegue ler as tabelas de outro, e a evolucao
# para instancias separadas (RDS por servico) nao exige mudar o codigo, so a
# string de conexao.
# =============================================================================
set -euo pipefail

echo "[postgres-init] Criando bancos e usuarios da Loja Veloz..."

create_database_and_user() {
  local db_name="$1"
  local db_user="$2"
  local db_password="$3"

  echo "[postgres-init] -> banco=${db_name} usuario=${db_user}"

  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" <<-EOSQL
    CREATE USER ${db_user} WITH PASSWORD '${db_password}';
    CREATE DATABASE ${db_name} OWNER ${db_user};
    -- Impede que qualquer papel se conecte a este banco por padrao.
    REVOKE ALL ON DATABASE ${db_name} FROM PUBLIC;
    GRANT CONNECT ON DATABASE ${db_name} TO ${db_user};
EOSQL

  # As permissoes de schema precisam ser concedidas DENTRO do banco alvo.
  # O usuario e dono do schema public para que o Prisma consiga criar e
  # alterar tabelas durante `prisma migrate deploy`.
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${db_name}" <<-EOSQL
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    ALTER SCHEMA public OWNER TO ${db_user};
    GRANT ALL ON SCHEMA public TO ${db_user};
EOSQL
}

create_database_and_user \
  "${ORDERS_DB_NAME:-orders_db}" \
  "${ORDERS_DB_USER:-orders_user}" \
  "${ORDERS_DB_PASSWORD:?ORDERS_DB_PASSWORD nao definido}"

create_database_and_user \
  "${INVENTORY_DB_NAME:-inventory_db}" \
  "${INVENTORY_DB_USER:-inventory_user}" \
  "${INVENTORY_DB_PASSWORD:?INVENTORY_DB_PASSWORD nao definido}"

create_database_and_user \
  "${PAYMENTS_DB_NAME:-payments_db}" \
  "${PAYMENTS_DB_USER:-payments_user}" \
  "${PAYMENTS_DB_PASSWORD:?PAYMENTS_DB_PASSWORD nao definido}"

echo "[postgres-init] Concluido. Tres bancos criados com usuarios isolados."
