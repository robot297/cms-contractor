build:
	docker compose up --build -d

serve:
	pnpm dev

cleanup:
	docker compose down -v
