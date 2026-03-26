# BitOracle Contracts

AssemblyScript smart contracts for OpNet.

## Build

```bash
npm install
npm run build:nft      # OracleNodeNFT
npm run build:registry # OracleRegistry
npm run build:pricefeedmusig2 # PriceFeedMuSig2
npm run build:vrf      # VRF
```

## Structure

```
src/oracle/
├── OracleNodeNFT.ts       # OP-721 operator identity
├── OracleRegistry.ts      # Oracle registration + slashing
├── PriceFeedMuSig2.ts     # Pull price verification
└── VRF.ts                 # Verifiable randomness (off-chain)
```

## Security Notes

- All contracts use `SafeMath` for arithmetic
- Bounds checking on all array accesses
- Schnorr signature verification via `Blockchain.verifySignature`
- Fee check in `verifyAndGetPrice` (2000 sats to treasury)

## Deployment

See `../node/src/scripts/` for deployment scripts.
