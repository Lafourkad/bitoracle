#!/bin/bash
# start-nodes.sh — Lance les 3 nœuds oracle en parallèle dans des sessions tmux

set -e
NODE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_DIR="$NODE_DIR/env"

echo "[start-nodes] Stopping existing sessions..."
tmux kill-session -t oracle-node1 2>/dev/null || true
tmux kill-session -t oracle-node2 2>/dev/null || true
tmux kill-session -t oracle-node3 2>/dev/null || true

echo "[start-nodes] Starting node1 (API :8081, P2P :7771)..."
tmux new-session -d -s oracle-node1 -x 220 -y 50
tmux send-keys -t oracle-node1 "cd $NODE_DIR && set -a && source $ENV_DIR/node1.env && set +a && node --import tsx/esm src/scripts/runDaemon.ts" Enter

sleep 2

echo "[start-nodes] Starting node2 (API :8082, P2P :7772)..."
tmux new-session -d -s oracle-node2 -x 220 -y 50
tmux send-keys -t oracle-node2 "cd $NODE_DIR && set -a && source $ENV_DIR/node2.env && set +a && node --import tsx/esm src/scripts/runDaemon.ts" Enter

sleep 2

echo "[start-nodes] Starting node3 (API :8083, P2P :7773)..."
tmux new-session -d -s oracle-node3 -x 220 -y 50
tmux send-keys -t oracle-node3 "cd $NODE_DIR && set -a && source $ENV_DIR/node3.env && set +a && node --import tsx/esm src/scripts/runDaemon.ts" Enter

echo ""
echo "[start-nodes] ✅ All 3 nodes started"
echo "  node1: tmux attach -t oracle-node1  (API :8081)"
echo "  node2: tmux attach -t oracle-node2  (API :8082)"
echo "  node3: tmux attach -t oracle-node3  (API :8083)"
echo ""
echo "Health checks:"
echo "  curl http://localhost:8081/health"
echo "  curl http://localhost:8082/health"
echo "  curl http://localhost:8083/health"
