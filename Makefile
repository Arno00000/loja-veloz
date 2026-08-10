# Atalhos para os comandos mais usados. Todos os alvos apenas encapsulam
# comandos que tambem estao documentados no README.md.
# Em Windows, use PowerShell com os comandos equivalentes do README ou WSL.

SHELL := /bin/bash
.DEFAULT_GOAL := help
COMPOSE := docker compose

.PHONY: help install build lint format typecheck test test-integration \
        up down logs ps restart seed migrate smoke k8s-render k8s-dryrun \
        tf-fmt tf-validate clean

help: ## Lista os alvos disponiveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Instala dependencias e gera o package-lock.json real
	npm install

build: ## Compila pacotes compartilhados, gera Prisma Client e compila as aplicacoes
	npm run build

lint: ## Executa o ESLint em todo o monorepo
	npm run lint

format: ## Verifica formatacao com Prettier
	npm run format:check

typecheck: ## Verificacao de tipos sem emissao
	npm run typecheck

test: ## Testes unitarios de todos os workspaces
	npm run test

test-integration: ## Testes de integracao contra a stack do Compose
	npm run test:integration

up: ## Sobe toda a stack local
	$(COMPOSE) up --build -d

down: ## Derruba a stack e remove volumes
	$(COMPOSE) down -v

logs: ## Acompanha os logs da stack
	$(COMPOSE) logs -f --tail=100

ps: ## Estado dos conteineres
	$(COMPOSE) ps

restart: down up ## Recria a stack do zero

migrate: ## Aplica as migrations em todos os bancos
	npm run prisma:migrate:deploy

seed: ## Popula o estoque com os SKUs de demonstracao
	npm run seed

smoke: ## Executa os smoke tests contra o Gateway local
	bash tests/smoke/smoke.sh

k8s-render: ## Renderiza o overlay de desenvolvimento
	kubectl kustomize kubernetes/overlays/development

k8s-dryrun: ## Valida os manifests sem aplicar
	kubectl apply --dry-run=client -k kubernetes/overlays/development

tf-fmt: ## Verifica a formatacao do Terraform
	terraform fmt -check -recursive terraform

tf-validate: ## Valida o ambiente de staging do Terraform
	cd terraform/environments/staging && terraform init -backend=false && terraform validate

clean: ## Remove artefatos de build
	npm run clean
