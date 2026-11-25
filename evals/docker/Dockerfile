# A clean Linux box for the router's checks and evals: Node 22 and Claude Code, the repo copied in, nothing from the
# author's machine (no ~/.claude, no login). Paid runs get ANTHROPIC_API_KEY from the host at `docker run` time only,
# so the key is never in the image. Build and run it with evals/docker.mjs, not by hand.
FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force
ENV DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
USER node
WORKDIR /repo
COPY --chown=node:node . .
WORKDIR /repo/evals
