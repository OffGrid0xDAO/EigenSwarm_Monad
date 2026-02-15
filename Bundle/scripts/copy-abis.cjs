const fs = require("fs");
const path = require("path");

const artifactsDir = path.join(__dirname, "..", "artifacts", "contracts");
const outDir = path.join(__dirname, "..", "src", "abis");

const contracts = [
  { file: "LaunchAndBundleBuy.sol", name: "LaunchAndBundleBuy.json" },
  { file: "BundleBuy.sol", name: "BundleBuy.json" },
  { file: "BundleSell.sol", name: "BundleSell.json" },
  { file: "FundWallets.sol", name: "FundWallets.json" },
];

if (!fs.existsSync(artifactsDir)) {
  console.error("Run 'npm run compile' first to generate artifacts.");
  process.exit(1);
}

for (const { file, name } of contracts) {
  const artifactPath = path.join(artifactsDir, file, path.basename(file, ".sol") + ".json");
  if (!fs.existsSync(artifactPath)) continue;
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const outPath = path.join(outDir, name);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(artifact.abi, null, 2));
  console.log("Wrote", name);
}
