const hre = require("hardhat");

const LENS = "0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea";

async function main() {
  console.log("Deploying BundleBuy...");
  const BundleBuy = await hre.ethers.getContractFactory("BundleBuy");
  const contract = await BundleBuy.deploy(LENS);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("BundleBuy deployed to:", address);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
