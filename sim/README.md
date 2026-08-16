# Torx + THRML bridge

The browser game stays playable without this process. When it is running, the forecast panel uses live JAX-backed sampling:

```bash
cd /Users/austinbeatty/Documents/ChatGPT/torx/creaturecity
../.venv/bin/python sim/mosslight_sim.py
```

The bridge listens on `http://127.0.0.1:8001`.

- THRML samples a four-node resource-risk graph.
- Torx evaluates a small parameterized stochastic circuit to derive exploration and social signals.
- The browser receives a forecast, sampled risk values, and a short explanation.


## Running it

The sidecar needs its own environment. From the repo root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r sim/requirements.txt
.venv/bin/python sim/mosslight_sim.py
```

`requirements.txt` used to point at a venv in the parent workspace that does not
exist on a fresh machine, which is why this had gone a long time without being
run at all — and why a three-gate circuit handed two parameters raised on every
request without anyone noticing.

## Tests

```bash
.venv/bin/pip install pytest
cd sim && ../.venv/bin/python -m pytest test_mosslight_sim.py -q
```

`fixtures/payload.json` is a real request captured from a 1400-tick settlement,
so the tests exercise the same graph shape the browser actually sends.
