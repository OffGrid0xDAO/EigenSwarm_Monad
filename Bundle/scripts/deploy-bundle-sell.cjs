const hre = require("hardhat");

const LENS = "0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  if (!signer) {
    throw new Error(
      "No signer (account) available. Set PRIVATE_KEY in .env or in your environment."
    );
  }
  console.log("Deploying BundleSell from:", await signer.getAddress());
  const BundleSell = await hre.ethers.getContractFactory("BundleSell");
  const contract = await BundleSell.deploy(LENS);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("BundleSell deployed to:", address);
  console.log("\nUpdate BUNDLE_SELL in src/lib/contracts.ts (BUNDLE_SELL_BY_CHAIN for Monad):");
  console.log(address);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
