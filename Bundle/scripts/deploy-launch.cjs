const hre = require("hardhat");

const LENS = "0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea";
const BONDING_CURVE_ROUTER = "0x6F6B8F1a20703309951a5127c45B49b1CD981A22";

async function main() {
  const [signer] = await hre.ethers.getSigners();
  if (!signer) {
    throw new Error(
      "No signer (account) available. Set PRIVATE_KEY in .env or in your environment."
    );
  }
  console.log("Deploying LaunchAndBundleBuy from:", await signer.getAddress());
  const LaunchAndBundleBuy = await hre.ethers.getContractFactory("LaunchAndBundleBuy");
  const contract = await LaunchAndBundleBuy.deploy(LENS, BONDING_CURVE_ROUTER);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("LaunchAndBundleBuy deployed to:", address);
  console.log("\nUpdate LAUNCH_AND_BUNDLE_BUY in src/lib/contracts.ts with:");
  console.log(address);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
