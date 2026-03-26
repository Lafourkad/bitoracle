import { ABIDataTypes, BitcoinAbiTypes } from 'opnet';
import type { BitcoinInterfaceAbi, FunctionBaseData } from 'opnet';

const fn = (entry: FunctionBaseData): FunctionBaseData => entry;

export const OracleRegistryAbi: BitcoinInterfaceAbi = [
    fn({ name: 'getOracleCount',  type: BitcoinAbiTypes.Function, inputs: [], outputs: [{ name: 'count', type: ABIDataTypes.UINT256 }] }),
    fn({ name: 'getOracleAtIndex', type: BitcoinAbiTypes.Function, inputs: [{ name: 'index', type: ABIDataTypes.UINT256 }], outputs: [{ name: 'oracleAddress', type: ABIDataTypes.ADDRESS }] }),
    fn({ name: 'getOracleInfo',   type: BitcoinAbiTypes.Function, inputs: [{ name: 'oracleAddress', type: ABIDataTypes.ADDRESS }], outputs: [
        { name: 'status',        type: ABIDataTypes.UINT256 },
        { name: 'pubKeyLow',     type: ABIDataTypes.UINT256 },
        { name: 'registerBlock', type: ABIDataTypes.UINT256 },
        { name: 'slashCount',    type: ABIDataTypes.UINT256 },
        { name: 'stake',         type: ABIDataTypes.UINT256 },
    ]}),
    fn({ name: 'isActive',   type: BitcoinAbiTypes.Function, inputs: [{ name: 'oracleAddress', type: ABIDataTypes.ADDRESS }], outputs: [{ name: 'active',   type: ABIDataTypes.BOOL }] }),
    fn({ name: 'isSlashed',  type: BitcoinAbiTypes.Function, inputs: [{ name: 'oracleAddress', type: ABIDataTypes.ADDRESS }], outputs: [{ name: 'slashed',  type: ABIDataTypes.BOOL }] }),
];

export default OracleRegistryAbi;
