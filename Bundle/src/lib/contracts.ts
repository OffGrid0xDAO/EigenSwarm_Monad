// Chain IDs (must match src/lib/chains.ts)
export const CHAIN_IDS = { SEPOLIA: 11155111, MONAD: 143 } as const;

// Contract addresses on Monad Mainnet
export const CONTRACTS = {
  LENS: "0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea",
  BONDING_CURVE_ROUTER: "0x6F6B8F1a20703309951a5127c45B49b1CD981A22",
  DEX_ROUTER: "0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137",
  WMON: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
  // Launch & Distribute: per-chain (deploy on each and set address)
  LAUNCH_AND_BUNDLE_BUY_BY_CHAIN: {
    [CHAIN_IDS.MONAD]: "0x9Bd469dE230FB04339aFf56977B08b595FF6B07e",
    [CHAIN_IDS.SEPOLIA]: "0x0000000000000000000000000000000000000000",
  } as Record<number, string>,
  BUNDLE_SELL_BY_CHAIN: {
    [CHAIN_IDS.MONAD]: "0xC5dbf04f7c97128ee9C7A5dd8Aaf6e9d6424644b", // Run npm run deploy:bundle-sell and set
    [CHAIN_IDS.SEPOLIA]: "0x0000000000000000000000000000000000000000",
  } as Record<number, string>,
  FUND_WALLETS_BY_CHAIN: {
    [CHAIN_IDS.MONAD]: "0xDdfa4EBd3Cc68FF2F0bf5136C1E744056E7B69aE", // Run npm run deploy:fund-wallets and set
    [CHAIN_IDS.SEPOLIA]: "0x0000000000000000000000000000000000000000",
  } as Record<number, string>,
} as const;

// ABIs
import lensAbi from "../abis/ILens.json";
import bondingCurveRouterAbi from "../abis/IBondingCurveRouter.json";
import dexRouterAbi from "../abis/IDexRouter.json";
import launchAndBundleBuyAbi from "../abis/LaunchAndBundleBuy.json";
import bundleSellAbi from "../abis/BundleSell.json";
import fundWalletsAbi from "../abis/FundWallets.json";

export const ABIS = {
  LENS: lensAbi,
  BONDING_CURVE_ROUTER: bondingCurveRouterAbi,
  DEX_ROUTER: dexRouterAbi,
  LAUNCH_AND_BUNDLE_BUY: launchAndBundleBuyAbi,
  BUNDLE_SELL: bundleSellAbi,
  FUND_WALLETS: fundWalletsAbi,
} as const;

// Constants
export const DEPLOY_FEE = 10n * 10n ** 18n; // 10 MON
export const DEFAULT_SLIPPAGE_BPS = 100n; // 1%
