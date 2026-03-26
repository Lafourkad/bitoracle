# BitOracle Frontend (Mint Dashboard)

React + Vite frontend for NFT minting and node operator dashboard.

## Dev

```bash
npm install
npm run dev
# Open http://localhost:5174/mint/
```

## Build

```bash
npm run build
# Static files in dist/
```

## Pages

- `/mint/` — Mint operator NFT (5000 sats on testnet)
- `/mint/dashboard` — Node config (set oracle key, payout address)
- `/mint/network` — Live network status (all oracles)

## Architecture

```
src/
├── App.tsx          # Router
├── Mint.tsx         # NFT mint UI
├── Dashboard.tsx    # Operator config
├── NetworkDashboard.tsx  # Network explorer
├── config.ts        # Contract addresses
└── *.abi.ts         # Contract ABIs
```

## Notes

- No private keys in frontend (read-only + user wallet)
- `signer: null` in all `sendTransaction()` calls
- Single provider instance (singleton)
