# BitOracle — Node Operator Setup (Testnet)

Run an oracle node in 5 steps.

## Prerequisites

- Node.js 20+
- Git

```bash
git clone <repo>
cd btc-oracle/node
npm install --legacy-peer-deps
```

---

## Step 1 — Generate your keys

```bash
node --import tsx/esm src/scripts/kit/generateKeys.ts
```

Creates:
- `keys.json` — your private keys (**never share this file**)
- `node.env`  — daemon config (contains your private keys too)

---

## Step 2 — Fund your address

Copy your `address` from `keys.json`. Send testnet BTC to it.

Ask the team for testnet sats, or use the faucet at https://testnet.opnet.org

Minimum: **100,000 sats** (covers all setup transactions).

---

## Step 3 — Mint your Node NFT

```bash
node --import tsx/esm src/scripts/kit/mintNFT.ts
```

Wait ~10 min for block confirmation, then get your tokenId:
```bash
curl "https://testnet.opnet.org/api/v1/address/tokens?address=<your_address>"
```

---

## Step 4 — Register your node on-chain

```bash
node --import tsx/esm src/scripts/kit/registerNode.ts --token <tokenId>
```

---

## Step 5 — Start the daemon

```bash
set -a && source node.env && set +a
node --import tsx/esm src/scripts/runDaemon.ts
```

Check it's running:
```bash
curl http://localhost:8080/health
curl "http://localhost:8080/signed-price?asset=BTC/USD"
```

---

## Troubleshooting

**"No UTXOs"** — Your address isn't funded yet or the block hasn't confirmed. Wait and retry.

**"Contract not indexed"** — OpNet indexing takes ~10 min after block confirmation. Wait and retry.

**"Oracle already registered"** — Your address is already registered. You're good.

---

## Contracts (testnet)

| Contract | Address |
|----------|---------|
| OracleNodeNFT | `opt1sqzchetuzymeewfkj8et2hvm2pkjg2ctpksm3mtun` |
| OracleRegistry | `opt1sqp0ce6tqqk3z4wwajgzufdm4vrwf234zjunljqkn` |
| PriceFeedMuSig2 | `opt1sqpaxrgxdlr2mmk9fmjyq5fjhh9epe4dva5m39wfq` |
