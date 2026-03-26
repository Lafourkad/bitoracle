# BitOracle

**Bitcoin-native decentralized oracle network for OpNet**

BitOracle provides trustless price feeds and verifiable randomness to smart contracts on OpNet. 100% BTC economy — no tokens, just sats.

> ⚠️ **TESTNET ONLY** — This project is in active development. Mainnet deployment planned for .

---

## What is BitOracle?

BitOracle is a pull-based oracle network built on Bitcoin via OpNet. Oracles sign prices off-chain using MuSig2 aggregated Schnorr signatures. dApps fetch signed prices and verify them on-chain in their own transactions.

**Why pull model?**
- Oracles pay **zero gas** — dApps pay their own
- Constant O(1) gas cost — no on-chain storage growth
- 1 signature serves unlimited dApps
- Scales to 100+ oracles without increasing gas

---

## Architecture

```
┌─────────────────┐     HTTP API      ┌──────────────────┐
│  Oracle Node    │ ───────────────► │      dApp         │
│  (3 nodes)       │  /signed-price   │   (consumer)       │
│                 │                  │                  │
│  ┌───────────┐   │                  │  ┌─────────────┐   │
│  │ PriceFetcher│  │                  │  │ Build TX    │   │
│  │ MuSig2 Sign │  │                  │  │ Call SC     │   │
│  │ HTTP Server│  │                  │  └─────────────┘   │
│  └───────────┘   │                  │         │        │
└─────────────────┘                  │         ▼
                                       │
                             ┌──────────────────┐
                             │   OpNet Contract  │
                             │ PriceFeedMuSig2  │
                             │                  │
                             │ verifyAndGetPrice │
                             │ → returns price   │
                             └──────────────────┘
```

**Key Innovation: Block-Anchored Signatures**

Each oracle committee signs **one price per Bitcoin block**. This ensures:
- No ambiguity — 1 block = 1 price
- No false-positive slashing — can't sign twice for same block  
- Aligned with Bitcoin's 10-minute block time

---

## Current State (Testnet)

| Component | Status | Notes |
|-----------|--------|-------|
| **OracleNodeNFT** | ✅ Deployed | OP-721 operator identity (5000 sats testnet) |
| **OracleRegistry v4** | ✅ Deployed | Oracle registration + slashing logic |
| **PriceFeedMuSig2** | ✅ Deployed | Pull price verification (fee: 2000 sats) |
| **VRF** | ⚠️ Partial | Deployed but **no off-chain fulfillment daemon yet** |
| **Oracle Daemon** | ✅ Running | 3 nodes active, pull model working |
| **End-to-end test** | ✅ Passed | Verified pull flow works on-chain |

**Deployed Addresses (OpNet Testnet):**

| Contract | Address |
|----------|---------|
| OracleNodeNFT | `opt1sqzchetuzymeewfkj8et2hvm2pkjg2ctpksm3mtun` |
| OracleRegistry v4 | `opt1sqp0ce6tqqk3z4wwajgzufdm4vrwf234zjunljqkn` |
| PriceFeedMuSig2 | `opt1sqr8d8dfjjxp6v9gk60fl8snk0fy7fwhe45cpj6va` |
| VRF | `opt1sqz0v22jrfpj2630rxlu6lwg5k6qru6d9xq4uxkty` |

---

## Known Issues & Weak Points

### Critical (Must Fix Before Mainnet)

| Issue | Severity | Description | Status |
|-------|----------|-------------|--------|
| **Sybil Attack Vulnerability** | 🔴 Critical | NFT costs only 5000 sats (testnet). 51 NFTs = 51% control for ~0.0051 BTC | Need stake requirement or identity verification |
| **VRF No Fulfillment** | 🔴 Critical | VRF contract deployed but no daemon to fulfill random requests | Need off-chain VRF service |
| **No Fee Distribution** | 🟡 Medium | Treasury collects fees but no distribution to node operators | Need reward contract |
| **Single Deployer Key** | 🟡 Medium | All contracts owned by single key — no multisig treasury | Need 2-of-3 multisig |
| **No Oracle Slashing Automation** | 🟡 Medium | Slashing logic exists but no automated fraud detection | Need monitoring daemon |

### Technical Debt

| Area | Issue | Impact |
|------|-------|--------|
| **Gas Optimization** | AggPubKey stored on-chain (SLOAD per call) | Should be passed in calldata for zero storage reads |
| **P2P Network** | libp2p code present but not integrated into daemon | Oracles don't coordinate off-chain yet |
| **Price Staleness** | MAX_STALE_BLOCKS = 3 (~30 min) may be too strict for Bitcoin | May need adjustment |
| **UTXO Management** | Deployer UTXOs exhausted frequently during testing | Need better UTXO management |

### Not Implemented (Planned)

- [ ] **Committee VRF Selection** — 10-of-100 nodes selected per round
- [ ] **DLC Stake Locking** — Bitcoin-locked stake for Sybil resistance
- [ ] **Reputation System** — Weighted voting by oracle age/uptime
- [ ] **Off-chain VRF Service** — Daemon to fulfill VRF requests
- [ ] **Treasury Multisig** — 2-of-3 for protocol funds
- [ ] **Monitoring & Alerting** — Automated fraud detection
- [ ] **Batch Price Feeds** — Multi-asset verification in single call
- [ ] **Frontend Dashboard** — Network status UI (code exists but not deployed)

---

## Security Model

### Anti-Sybil (Current)
- NFT required to register oracle (5000 sats testnet, 0.05 BTC planned mainnet)
- Max 100 oracles
- Slashing excludes oracle permanently

### Anti-Sybil (Planned)
- **DLC Stake:** 0.05 BTC locked in 2-of-2 P2WSH (oracle + protocol)
- **Reputation Weight:** New oracles have reduced voting power for 30 days
- **Committee Sampling:** VRF selects 10 nodes per round — attacker needs 51% of 100 nodes AND luck

### Slashing Conditions

| Condition | Detection | Penalty |
|-----------|-----------|---------|
| Double-sign same block | On-chain proof (2 sigs with different prices) | Permanent exclusion |
| Inactivity > 100 blocks | Missing heartbeat | Temporary exclusion |
| Malformed signature | On-chain verification failure | Transaction reverts |

---

## Quick Start

### Prerequisites
- Node.js 20+
- TypeScript
- Bitcoin testnet sats (get from [OpNet faucet](https://testnet.opnet.org))

### Run an Oracle Node

```bash
git clone https://github.com/Lafourkad/bitoracle.git
cd bitoracle/node

# Install dependencies
npm install --legacy-peer-deps

# Generate your oracle keys
node --import tsx/esm src/scripts/kit/generateKeys.ts

# Fund your address (from keys.json) with testnet BTC
# Mint your operator NFT
node --import tsx/esm src/scripts/kit/mintNFT.ts

# Register your oracle
node --import tsx/esm src/scripts/kit/registerNode.ts --token <tokenId>

# Start the daemon
source node.env && node --import tsx/esm src/scripts/runDaemon.ts
```

### API Endpoints

Once running, your oracle exposes:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Node status |
| `GET /signed-price?asset=BTC/USD` | Price + MuSig2 signature |
| `GET /signed-prices` | Batch of all assets |
| `GET /status` | Full node info |

---

## Consuming Price Feeds (for dApps)

### 1. Fetch Signed Price (Off-chain)

```bash
curl http://oracle-node:8080/signed-price?asset=BTC/USD
```

Response:
```json
{
  "asset": "BTC/USD",
  "price": "6940184",
  "blockNum": "11519",
  "sig": "7fc4c29d...",
  "aggPubKey": "dfb3624a..."
}
```

### 2. Verify On-chain (in your dApp)

Your dApp contract calls:

```typescript
// In your AssemblyScript contract
const result = priceFeed.verifyAndGetPrice(
    asset,      // "BTC/USD" as bytes
    price,      // 6940184n
    blockNum,   // 11519n
    sig,        // 64 bytes Schnorr signature
    aggPubKey   // 32 bytes aggregated public key
);

// Contract verifies:
// 1. Signature is valid Schnorr
// 2. Block is recent (< 3 blocks old)
// 3. Fee paid (2000 sats to treasury)

// Returns verified price
if (!result.revert) {
    const verifiedPrice = result.properties.price;
    // Use price in your logic...
}
```

### 3. Include Fee in Transaction

Your transaction must include an output to the treasury:

```typescript
// When building your tx
extraOutputs: [{
    address: treasuryAddress,  // from priceFeed.getTreasuryAddress()
    value: 2000n  // 2000 sats fee
}]
```

---

## Project Structure

```
bitoracle/
├── contracts/              # AssemblyScript smart contracts
│   ├── src/oracle/
│   │   ├── OracleNodeNFT.ts      # OP-721 operator NFT
│   │   ├── OracleRegistry.ts     # Oracle registration + slashing
│   │   ├── PriceFeedMuSig2.ts    # Pull price verification
│   │   └── VRF.ts                # Verifiable randomness
│   └── build/               # Compiled WASM
├── node/                   # Oracle daemon
│   ├── src/
│   │   ├── scripts/
│   │   │   ├── runDaemon.ts      # Main daemon (pull model)
│   │   │   ├── testPullModel.ts  # End-to-end test
│   │   │   └── kit/              # Operator setup scripts
│   │   ├── musig2/              # MuSig2 implementation
│   │   └── http/                # HTTP API server
│   └── keys/                # Private keys (gitignored)
├── frontend-mint/          # React dashboard (WIP)
├── node-kit/               # Standalone setup scripts
└── README.md
```

---

## Roadmap

### Phase 1-7: MVP ✅ (Completed)

- [x] Core contracts (NFT, Registry, PriceFeed)
- [x] MuSig2 aggregated signatures
- [x] Pull model daemon
- [x] HTTP API for signed prices
- [x] End-to-end test passed
- [x] Testnet deployment

### Phase 8: VRF (In Progress)

- [ ] Off-chain VRF fulfillment daemon
- [ ] VRF integration tests
- [ ] VRF documentation

### Phase 9: Sybil Resistance ()

- [ ] DLC stake locking (0.05 BTC P2WSH 2-of-2)
- [ ] Reputation weighting system
- [ ] Committee VRF selection (10-of-100 per round)

### Phase 10: Economic Model ()

- [ ] Treasury multisig (2-of-3)
- [ ] Fee distribution contract
- [ ] Node operator rewards

### Phase 11: Monitoring ()

- [ ] Automated fraud detection
- [ ] Slashing automation
- [ ] Network health dashboard
- [ ] Alert system

### Phase 12: Mainnet ()

- [ ] Security audit
- [ ] Mainnet NFT price (0.05 BTC)
- [ ] Mainnet deployment
- [ ] Bug bounty program

### Phase 13: Scale ()

- [ ] 100+ oracle nodes
- [ ] Multi-asset support (ETH/USD, SOL/USD, etc.)
- [ ] Cross-chain price feeds
- [ ] Enterprise SLA

---

## Tech Stack

| Layer | Technology |
|-------|-------------|
| Smart Contracts | AssemblyScript → WASM (OpNet) |
| Cryptography | MuSig2 Schnorr (BIP-340), ML-DSA (post-quantum) |
| Node | TypeScript + Express + libp2p |
| Frontend | React + Vite |
| Network | Bitcoin L1 + OpNet |

---

## Contributing

This project is in active development. Contributions welcome:

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a pull request

**Areas needing help:**
- VRF off-chain fulfillment daemon
- Sybil resistance mechanisms
- Monitoring & alerting
- Documentation improvements
- Gas optimizations

---

## Security Audits

**Status:** Not audited yet

Planned audit before mainnet (). Current code should NOT be used for production/mainnet funds.

---

## License

MIT

---

## Resources

- [OpNet Documentation](https://docs.opnet.org)
- [MuSig2 (BIP-327)](https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki)
- [Schnorr Signatures (BIP-340)](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki)
- [BitOracle Testnet Explorer](https://testnet.opnet.org)
- [Telegram Community](https://t.me/+IcOmSUABps85MTdk)

---

## Disclaimer

⚠️ **TESTNET SOFTWARE — USE AT YOUR OWN RISK**

This software is in active development. It has not been audited. It may contain bugs that could result in loss of funds. Do not use on mainnet without proper security review.

Built with ₿ on OpNet
