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
