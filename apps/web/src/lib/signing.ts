export function buildRegisterMessage(eigenId: string, ownerAddress: string, timestamp: number): string {
  return `EigenSwarm Register\neigenId: ${eigenId}\nowner: ${ownerAddress.toLowerCase()}\ntimestamp: ${timestamp}`;
}

export function buildLiquidateMessage(eigenId: string, ownerAddress: string, timestamp: number): string {
  return `EigenSwarm Liquidate\neigenId: ${eigenId}\nowner: ${ownerAddress.toLowerCase()}\ntimestamp: ${timestamp}`;
}

export function buildAdjustMessage(eigenId: string, ownerAddress: string, timestamp: number): string {
  return `EigenSwarm Adjust\neigenId: ${eigenId}\nowner: ${ownerAddress.toLowerCase()}\ntimestamp: ${timestamp}`;
}

export function buildTakeProfitMessage(eigenId: string, ownerAddress: string, timestamp: number): string {
  return `EigenSwarm TakeProfit\neigenId: ${eigenId}\nowner: ${ownerAddress.toLowerCase()}\ntimestamp: ${timestamp}`;
}

export function buildDeleteMessage(eigenId: string, ownerAddress: string, timestamp: number): string {
  return `EigenSwarm Delete\neigenId: ${eigenId}\nowner: ${ownerAddress.toLowerCase()}\ntimestamp: ${timestamp}`;
}

export function buildTerminateMessage(eigenId: string, ownerAddress: string, timestamp: number): string {
  return `EigenSwarm Terminate\neigenId: ${eigenId}\nowner: ${ownerAddress.toLowerCase()}\ntimestamp: ${timestamp}`;
}
