# RocketShip eval harness.
#
# Additive: none of these targets touch the product. `make eval` runs every
# arm over the frozen eval set and writes results/summary.md.
#
# Windows without make: every target is a one-line python command, listed by
# `make help`. Run them directly, e.g. `python -m evals.runner`.

PYTHON ?= python

.PHONY: help eval eval-smoke eval-wide stage-a stage-b stage-c preflight test report fixture fixture-wide news-fixture news-audit selftest clean-results clean-cache

help:
	@echo "make eval          - run ALL THREE stages, write results/"
	@echo "make preflight     - one real API call: model + thinking check (~$$0.00002)"
	@echo "make stage-a       - screen vs forward returns   (FREE, no LLM)"
	@echo "make stage-b       - the debate arms             (COSTS MONEY)"
	@echo "make stage-c       - portfolio construction      (FREE, no LLM)"
	@echo "make eval-wide     - stage B on 12 dates instead of 4 (costs more)"
	@echo "make eval-smoke    - 12 tickers/date, 1 seed (cheap sanity run)"
	@echo "make test          - hermetic pytest suite (no network)"
	@echo "make report        - render results/ into results/report.html"
	@echo "make selftest      - validate the harness itself (no LLM calls)"
	@echo "make fixture       - rebuild the frozen 4-date eval set (needs network)"
	@echo "make fixture-wide  - rebuild the 12-date set for stages A and C"
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
# All three stages. A and C are free; B is the only one that spends.
eval: selftest stage-a stage-c stage-b

# Stage A: does the deterministic screen rank forward returns? Zero LLM cost.
stage-a:
	$(PYTHON) -m evals.stages.screen

# Stage C: does portfolio construction beat equal weight out of sample? Zero cost.
stage-c:
	$(PYTHON) -m evals.stages.portfolio

# Stage B: the paid one. Hard budget ceiling; aborts rather than exceeding it.
stage-b: preflight
	$(PYTHON) -m evals.runner --budget 5.00

# Stage B over 12 as-of dates rather than 4. Four dates is the binding
# constraint on every interval in Stage B - Stage A showed the screen's own
# estimate flipping sign between 4 dates and 12.
eval-wide: preflight
	$(PYTHON) -m evals.runner --wide --budget 8.00

# One real call before spending anything: model resolves, JSON mode works,
# and thinking is actually off (V4 enables it by default and it bills as output).
preflight:
	$(PYTHON) -m evals.preflight

test:
	$(PYTHON) -m pytest

# Render results/*.json into one self-contained HTML report. Generated rather
# than written, so the page cannot drift from the numbers it reports.
report:
	$(PYTHON) -m evals.publish

eval-smoke: selftest
	$(PYTHON) -m evals.runner --limit 12 --seeds 1 --budget 0.50

selftest:
	$(PYTHON) -m evals.selftest

fixture-wide:
	$(PYTHON) -m evals.build_fixture --wide

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
