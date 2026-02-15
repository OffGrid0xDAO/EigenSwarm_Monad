const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  if (!signer) {
    throw new Error(
      "No signer (account) available. Set PRIVATE_KEY in .env or in your environment."
    );
  }
  console.log("Deploying FundWallets from:", await signer.getAddress());
  const FundWallets = await hre.ethers.getContractFactory("FundWallets");
  const contract = await FundWallets.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("FundWallets deployed to:", address);
  console.log("\nUpdate FUND_WALLETS_BY_CHAIN in src/lib/contracts.ts (Monad):");
  console.log(address);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
