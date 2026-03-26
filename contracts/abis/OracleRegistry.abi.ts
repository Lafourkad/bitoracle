import { ABIDataTypes, BitcoinAbiTypes, OP_NET_ABI } from 'opnet';

export const OracleRegistryEvents = [];

export const OracleRegistryAbi = [
    {
        name: 'registerOracle',
        inputs: [
            { name: 'pubKeyLow', type: ABIDataTypes.UINT256 },
            { name: 'pubKeyHigh', type: ABIDataTypes.UINT256 },
            { name: 'stakeAmount', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'addOracle',
        inputs: [
            { name: 'oracle', type: ABIDataTypes.ADDRESS },
            { name: 'pubKeyLow', type: ABIDataTypes.UINT256 },
            { name: 'pubKeyHigh', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setNFTAddress',
        inputs: [{ name: 'nftAddress', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'registerNode',
        inputs: [
            { name: 'tokenId', type: ABIDataTypes.UINT256 },
            { name: 'schnorrPubKey', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getNFTAddress',
        inputs: [],
        outputs: [{ name: 'nftAddress', type: ABIDataTypes.ADDRESS }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'requestUnstake',
        inputs: [],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'publishFraudProof',
        inputs: [
            { name: 'oracleAddress', type: ABIDataTypes.ADDRESS },
            { name: 'price1', type: ABIDataTypes.UINT256 },
            { name: 'price2', type: ABIDataTypes.UINT256 },
            { name: 'blockNum', type: ABIDataTypes.UINT256 },
            { name: 'sig1', type: ABIDataTypes.BYTES },
            { name: 'sig2', type: ABIDataTypes.BYTES },
            { name: 'asset', type: ABIDataTypes.BYTES },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'isActive',
        inputs: [{ name: 'oracleAddress', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'active', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getStake',
        inputs: [{ name: 'oracleAddress', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'stake', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'isSlashed',
        inputs: [{ name: 'oracleAddress', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'slashed', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getPubKey',
        inputs: [{ name: 'oracleAddress', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'pubKeyLow', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getOracleCount',
        inputs: [],
        outputs: [{ name: 'count', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getOracleAtIndex',
        inputs: [{ name: 'index', type: ABIDataTypes.UINT256 }],
        outputs: [{ name: 'oracleAddress', type: ABIDataTypes.ADDRESS }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getOracleInfo',
        inputs: [{ name: 'oracleAddress', type: ABIDataTypes.ADDRESS }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    ...OracleRegistryEvents,
    ...OP_NET_ABI,
];

export default OracleRegistryAbi;
