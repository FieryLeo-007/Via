.PHONY: dev test bench fixtures seed

dev:
	FLASK_APP=app.py FLASK_DEBUG=1 .venv/bin/flask run

test:
	.venv/bin/pytest tests/ -q

bench:
	.venv/bin/python -m bench.run_discovery

fixtures:
	@echo "Records live OpenWeb Ninja responses and spends API quota (free tier: 100 req/month)."
	@echo "Not implemented yet — build a recorder and run it manually with DATA_MODE=live when quota spend is approved."

seed:
	@echo "Demo persona seeding belongs to F2 (Hyper-Personalization) — not built yet."
