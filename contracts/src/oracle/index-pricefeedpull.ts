import { PriceFeedPull } from './PriceFeedPull';

export function abort(msg: string, file: string, line: u32, col: u32): void {
    throw new Error(`Abort: ${msg} at ${file}:${line}:${col}`);
}

export * from './PriceFeedPull';
