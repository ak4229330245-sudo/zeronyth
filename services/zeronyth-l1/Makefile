SHELL := /usr/bin/env bash

.PHONY: start doctor init up down reset status validate test compile e2e dashboard logs package verify-release smoke ci

start:
	./scripts/start.sh

doctor:
	./scripts/doctor.sh

init:
	./scripts/init-network.sh

up:
	docker compose up -d --build

down:
	docker compose down

reset:
	./scripts/reset-network.sh

status:
	./scripts/status.sh

validate:
	./scripts/validate-config.sh

test:
	python3 -m unittest discover -s tests -v

compile:
	./scripts/compile-contracts.sh

smoke:
	./scripts/smoke-test.sh

e2e:
	./scripts/e2e-test.sh

dashboard:
	docker compose up -d --build explorer faucet

logs:
	docker compose logs -f --tail=100

package:
	./scripts/package-release.sh

verify-release:
	python3 ./scripts/verify-release.py ./dist/zeronyth-l1-starter-kit-v$$(cat VERSION).zip

ci:
	cp -n .env.example .env 2>/dev/null || true
	./scripts/validate-config.sh
	python3 -m unittest discover -s tests -v
	./scripts/compile-contracts.sh
	./scripts/init-network.sh
	docker compose up -d --build
	./scripts/wait-for-rpc.sh
	./scripts/smoke-test.sh
	./scripts/e2e-test.sh
	./scripts/package-release.sh
	python3 ./scripts/verify-release.py ./dist/zeronyth-l1-starter-kit-v$$(cat VERSION).zip
