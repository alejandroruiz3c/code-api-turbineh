# open-decider

Serves an open-weights Quyet model behind the TypeSafe `/v1/systemone` shape so `OpenDecider` can use the
official TypeSafe SDK with a different `baseURL`. Binds to 127.0.0.1. No secrets.

```bash
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python server.py --model chinhnc/Quyet-1.0-Medium --port 8765   # dev (Apple MPS / CUDA / CPU)
# production: --model chinhnc/Quyet-1.0-Large on one 80 GB GPU
```

Endpoints: `POST /v1/systemone`, `GET /v1/models`, `GET /health`.
Limits (Quyet): ≤ 10 options per question (the decider splits larger Choices), ≤ ~6,000 state tokens.
Quyet is Apache-2.0; keep its NOTICE when redistributing.
