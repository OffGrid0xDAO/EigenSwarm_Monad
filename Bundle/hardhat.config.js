import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";

// Load .env from project root (where this config file lives)
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  loadEnv({ path: path.resolve(__dirname, ".env") });
} catch {
  loadEnv(); // fallback: cwd
}

// Accept with or without 0x prefix; trim whitespace/CRLF
const raw = (process.env.PRIVATE_KEY || process.env.private_key || "").trim();
const PRIVATE_KEY = raw.startsWith("0x") ? raw : (raw ? `0x${raw}` : "");

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  paths: {
    sources: "./contracts",
  },
  networks: {
    hardhat: {
      chainId: 143,
    },
    monad: {
      url: "https://rpc.monad.xyz",
      chainId: 143,
      accounts: PRIVATE_KEY.length > 10 ? [PRIVATE_KEY] : [],
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: PRIVATE_KEY.length > 10 ? [PRIVATE_KEY] : [],
      timeout: 60000,
    },
  },
};
