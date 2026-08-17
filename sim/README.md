# Torx + THRML bridge

The browser game stays playable without this process. When it is running, the
forecast panel uses live JAX-backed sampling:

```bash
# Run these commands from the repository root.
.venv/bin/python sim/mosslight_sim.py
```

The bridge listens on `http://127.0.0.1:8001`.

- THRML samples a settlement-shaped resource-risk graph.
- Torx evaluates a small parameterized stochastic circuit to derive exploration and social signals.
- The browser receives a forecast, sampled risk values, and a short explanation.

## Running it

The sidecar needs its own environment. From the repo root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r sim/requirements.txt
.venv/bin/python sim/mosslight_sim.py
```

The requirements file includes the test runner as well as the sidecar runtime,
so a fresh environment can run the full adapter contract without a second
manual install.

## Tests

```bash
npm run test:python
```

`fixtures/payload.json` is a real request captured from a 1400-tick settlement,
so the tests exercise the same graph shape the browser actually sends.
