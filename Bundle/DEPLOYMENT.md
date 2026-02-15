# Deployment Guide

This guide walks you through deploying the nad.fun Bundler application.

## Prerequisites

- Node.js 18+ installed
- Git (optional, for version control)
- Wallet with MON tokens for contract deployment

## Frontend Deployment

### Option 1: Vercel (Recommended)

1. Push your code to GitHub

2. Go to [vercel.com](https://vercel.com) and import your repository

3. Configure build settings:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

4. Deploy!

### Option 2: Netlify

1. Push your code to GitHub

2. Go to [netlify.com](https://netlify.com) and create a new site

3. Configure build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`

4. Deploy!

### Option 3: Self-Hosted

```bash
# Build for production
npm run build

# Serve with any static file server
# Example with serve:
npx serve dist

# Or with nginx, apache, etc.
```

## Smart Contract Deployment

See [`contracts/deploy.md`](contracts/deploy.md) for detailed instructions.

### Quick Start with Foundry

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Deploy BundleBuy contract
forge create --rpc-url https://rpc.monad.xyz \
  --private-key YOUR_PRIVATE_KEY \
  --constructor-args 0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea \
  contracts/BundleBuy.sol:BundleBuy
```

### After Deployment

1. Copy the deployed contract address

2. Update `src/lib/contracts.ts`:
   ```typescript
   BUNDLE_BUY: '0xYourDeployedAddress', // Update this line
   ```

3. Rebuild and redeploy the frontend:
   ```bash
   npm run build
   ```

## Environment Variables (Optional)

If you want to add custom RPC endpoints or API keys, create a `.env` file:

```bash
VITE_MONAD_RPC_URL=https://rpc.monad.xyz
```

Then update `src/lib/config.ts` to use the environment variable.

## Post-Deployment Checklist

- [ ] BundleBuy contract deployed to Monad
- [ ] Contract address updated in `src/lib/contracts.ts`
- [ ] Frontend builds without errors (`npm run build`)
- [ ] Frontend deployed to hosting platform
- [ ] Wallet connection works on production
- [ ] Launch Token feature tested
- [ ] Bundle Buy feature tested
- [ ] All transactions complete successfully

## Monitoring

### View Transactions

- Monad Block Explorer: https://monadvision.com
- View your deployed contract
- Monitor transaction history

### Common Issues

**"Invalid Chain" Error**
- User's wallet is not connected to Monad
- Prompt them to add Monad network (Chain ID: 143)

**"Insufficient Funds" Error**
- User doesn't have enough MON
- Check balance before transactions

**Contract Not Found**
- Verify contract address is correct in `contracts.ts`
- Check contract is deployed on Monad mainnet

## Updating the Application

1. Make changes to the code
2. Test locally: `npm run dev`
3. Build: `npm run build`
4. Deploy updated `dist/` folder to your hosting platform
5. If contract changes, redeploy the contract and update address

## Support

For issues:
- Check the [README.md](README.md)
- Review [nad.fun documentation](https://nad-fun.gitbook.io/nad.fun)
- Verify Monad RPC is accessible
