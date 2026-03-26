import { ABIDataTypes, BitcoinAbiTypes, OP_NET_ABI } from 'opnet';

export const PriceFeedMuSig2Events = [];

export const PriceFeedMuSig2Abi = [
    {
        name: 'verifyAndGetPrice',
        inputs: [
            { name: 'asset', type: ABIDataTypes.BYTES },
            { name: 'price', type: ABIDataTypes.UINT256 },
            { name: 'blockNum', type: ABIDataTypes.UINT256 },
            { name: 'sig', type: ABIDataTypes.BYTES },
            { name: 'aggPubKey', type: ABIDataTypes.BYTES },
        ],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setAggPubKey',
        inputs: [
            { name: 'pubKeyLow', type: ABIDataTypes.UINT256 },
            { name: 'pubKeyHigh', type: ABIDataTypes.UINT256 },
        ],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setTreasuryAddress',
        inputs: [{ name: 'btcAddress', type: ABIDataTypes.STRING }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setFeeSats',
        inputs: [{ name: 'feeSats', type: ABIDataTypes.UINT256 }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getTreasuryAddress',
        inputs: [],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getFeeSats',
        inputs: [],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setRegistry',
        inputs: [{ name: 'registry', type: ABIDataTypes.ADDRESS }],
        outputs: [],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getAggPubKey',
        inputs: [],
        outputs: [{ name: 'pubKeyLow', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    ...PriceFeedMuSig2Events,
    ...OP_NET_ABI,
];

export default PriceFeedMuSig2Abi;
