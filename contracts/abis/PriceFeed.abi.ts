import { ABIDataTypes, BitcoinAbiTypes, OP_NET_ABI } from 'opnet';

export const PriceFeedEvents = [];

export const PriceFeedAbi = [
    {
        name: 'submitPrice',
        inputs: [
            { name: 'asset', type: ABIDataTypes.BYTES },
            { name: 'price', type: ABIDataTypes.UINT256 },
            { name: 'blockNum', type: ABIDataTypes.UINT256 },
            { name: 'signature', type: ABIDataTypes.BYTES },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setRegistry',
        inputs: [{ name: 'oracleRegistry', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getPrice',
        inputs: [{ name: 'asset', type: ABIDataTypes.BYTES }],
        outputs: [{ name: 'price', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getLatestBlock',
        inputs: [{ name: 'asset', type: ABIDataTypes.BYTES }],
        outputs: [{ name: 'blockNumber', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    ...PriceFeedEvents,
    ...OP_NET_ABI,
];

export default PriceFeedAbi;
