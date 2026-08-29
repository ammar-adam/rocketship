# RocketShip eval harness.
#
# Additive: none of these targets touch the product. `make eval` runs every
# arm over the frozen eval set and writes results/summary.md.
#
# Windows without make: every target is a one-line python command, listed by
# `make help`. Run them directly, e.g. `python -m evals.runner`.

PYTHON ?= python

.PHONY: help eval eval-smoke fixture news-fixture news-audit selftest clean-results clean-cache

help:
	@echo "make eval          - run all arms, all seeds, write results/summary.md"
	@echo "make eval-smoke    - 5 tickers/date, 2 seeds (cheap sanity run)"
	@echo "make selftest      - validate the harness itself (no LLM calls)"
	@echo "make fixture       - rebuild the frozen eval set (needs network)"
	@echo "make news-fixture  - fetch as-of news (needs NEWS_API_KEY)"
	@echo "make news-audit    - audit the product's NewsAPI path for leaks"
	@echo "make clean-results - delete results/ (keeps the LLM cache)"
	@echo "make clean-cache   - delete the LLM cache (next run re-pays DeepSeek)"
	@echo ""
	@echo "Without make:"
	@echo "  $(PYTHON) -m evals.runner"
	@echo "  $(PYTHON) -m evals.runner --limit 5 --seeds 2"
	@echo "  $(PYTHON) -m evals.selftest"
	@echo "  $(PYTHON) -m evals.build_fixture"
	@echo "  $(PYTHON) -m evals.news --fetch"
	@echo "  $(PYTHON) -m evals.news --audit"

# The main entry point. Self-test runs first: if the harness cannot recover a
# signal it plants itself, its verdict on the debate is worthless.
eval: selftest
	$(PYTHON) -m evals.runner

eval-smoke: selftest
	$(PYTHON) -m evals.runner --limit 5 --seeds 2

selftest:
	$(PYTHON) -m evals.selftest

fixture:
	$(PYTHON) -m evals.build_fixture

news-fixture:
	$(PYTHON) -m evals.news --fetch

news-audit:
	$(PYTHON) -m evals.news --audit

clean-results:
	$(PYTHON) -c "import shutil; shutil.rmtree('results', ignore_errors=True); print('removed results/')"

clean-cache:
	$(PYTHON) -c "import shutil, os; shutil.rmtree(os.path.join('evals','cache'), ignore_errors=True); print('removed evals/cache/')"
