# BitOracle

**Bitcoin-native decentralized oracle network for OpNet**

BitOracle provides trustless price feeds and verifiable randomness to smart contracts on OpNet, Bitcoin's smart contract layer. 100% BTC economy — no tokens, just sats.

## Architecture

### Pull Model (Zero Gas for Oracles)

Oracles sign prices off-chain. dApps fetch signed prices via HTTP and verify on-chain in their own transactions.

```
Oracle                         dApp                    OpNet
  │                              │                        │
  ├─ fetch price from sources    │                        │
  ├─ sign {block, price}         │                        │
  ├─ expose via HTTP API ────────►                        │
  │                              ├─ GET /signed-price     │
  │                              ├─ build tx with fee     │
  │                              └─ verifyAndGetPrice() ──►
  │                                                       ├─ verify Schnorr
  │                                                       ├─ check fee output
  │                                                       └─ return price
```

**Benefits:**
- Oracles pay 0 gas — dApps pay their own
- Constant gas cost O(1) — no on-chain storage
- Scalable — 1 signature serves unlimited dApps

### Block-Anchored Signatures

Each oracle committee signs **one price per Bitcoin block**. This ensures:
- No ambiguity — 1 block = 1 price
- No false-positive slashing — can't sign twice for same block
- Aligned with Bitcoin's 10-minute block time

### Committee Selection (VRF)

- Max 100 oracle nodes (NFT holders)
- Committee of 7 selected via VRF per round
- MuSig2 aggregated signature (64 bytes, constant size)
- Threshold: 5-of-7 (tolerates 2 offline)

## Contracts

| Contract | Purpose | Testnet Address |
|----------|---------|-----------------|
| `OracleNodeNFT` | Node operator identity (OP-721) | `opt1sqzchetuzymeewfkj8et2hvm2pkjg2ctpksm3mtun` |
| `OracleRegistry` | Oracle registration and slashing | `opt1sqp0ce6tqqk3z4wwajgzufdm4vrwf234zjunljqkn` |
| `PriceFeedMuSig2` | Pull price verification | `opt1sqr8d8dfjjxp6v9gk60fl8snk0fy7fwhe45cpj6va` |
| `VRF` | Verifiable randomness | `opt1sqz0v22jrfpj2630rxlu6lwg5k6qru6d9xq4uxkty` |

## Security

### Audit Status (Internal)

**Fixed issues:**
- ✅ Stake output verification (self-send bypass prevented)
- ✅ Oracle re-registration blocked
- ✅ MuSig2 nonce determinism (HMAC-based)
- ✅ Token bounds checking in NFT contract
- ✅ VRF input validation (64-byte proof, 32-byte blockHash)
- ✅ Price staleness limit (3 blocks = ~30 min)

**Anti-Sybil:**
- NFT costs 0.05 BTC (mainnet) / 5000 sats (testnet)
- Slashing excludes node permanently
- Future: stake lock + reputation system

### Slashing

Fraud = signing two different prices for the same block + asset.

```
Proof: {oracle, block, asset, price1, sig1, price2, sig2}
Verification: contract checks both Schnorr signatures valid
Result: oracle status → SLASHED (permanent exclusion)
```

## Running a Node

### Prerequisites

- Node.js 20+
- Bitcoin testnet sats (~100k recommended)

### Setup

```bash
git clone https://github.com/bitoracle/bitoracle.git
cd bitoracle/node

# Install dependencies
npm install --legacy-peer-deps

# Generate your oracle keys
node --import tsx/esm src/scripts/kit/generateKeys.ts

# Fund your address (from keys.json)
# Testnet faucet: https://testnet.opnet.org

# Mint your operator NFT
node --import tsx/esm src/scripts/kit/mintNFT.ts

# Register your node
node --import tsx/esm src/scripts/kit/registerNode.ts --token <tokenId>

# Start the daemon
source node.env && node --import tsx/esm src/scripts/runDaemon.ts
```

### API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Node status |
| `GET /signed-price?asset=BTC/USD` | Price + MuSig2 signature |
| `GET /signed-prices` | All assets batch |
| `GET /status` | Full node info |

## Consuming Price Feeds

### 1. Fetch signed price (off-chain)

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

### 2. Verify on-chain (in your smart contract)

```solidity
// Your dApp contract
function liquidate(bytes calldata priceData) external {
    (
        bytes memory asset,
        uint256 price,
        uint256 blockNum,
        bytes memory sig,
        bytes memory aggPubKey
    ) = abi.decode(priceData, ...);

    // Pay fee to treasury (2000 sats)
    // Include output in your tx

    // Verify oracle signature
    priceFeed.verifyAndGetPrice(asset, price, blockNum, sig, aggPubKey);

    // Use verified price
    if (price < LIQUIDATION_THRESHOLD) {
        // liquidate...
    }
}
```

## Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1-4 | Core contracts + NFT | ✅ Done |
| 5 | Pull model daemon | ✅ Done |
| 6 | Dashboard frontend | ✅ Done |
| 7 | End-to-end test | ✅ Done |
| 8 | VRF off-chain | 🔲 Next |
| 9 | Committee VRF selection | 🔲 |
| 10 | Fee distribution | 🔲 |
| 11 | Mainnet deployment | 🔲 |
| 12 | Multisig treasury | 🔲 |

## Tech Stack

- **Contracts:** AssemblyScript + OpNet runtime
- **Cryptography:** MuSig2 Schnorr (BIP-340), ML-DSA (post-quantum)
- **Node:** TypeScript + Express + libp2p
- **Frontend:** React + Vite

## License

MIT

## Resources

- [OpNet Documentation](https://docs.opnet.org)
- [Bitcoin Improvement Proposals](https://github.com/bitcoin/bips)
- [MuSig2 (BIP-327)](https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki)

---

Built with ₿ on OpNet
