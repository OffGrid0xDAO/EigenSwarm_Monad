// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ERC-8004 Identity Registry interface (minimal)
interface IIdentityRegistry8004 {
    function ownerOf(uint256 agentId) external view returns (address);
}

/// @title EigenVault
/// @notice Holds user ETH deposits for EigenSwarm agents with ERC-8004 NFT-based
///         ownership — transferring the agent NFT transfers control of the vault
///         balance, token positions, and trading history.
/// @dev When an eigen has an associated agentId (from the 8004 Identity Registry),
///      ownership is resolved dynamically via `ownerOf(agentId)`. This means
///      transferring the NFT immediately changes who can withdraw, suspend, and
///      terminate the eigen. Eigens without agentId use address-based ownership.
///
///      Balance migration: Agent-owned eigens store funds in `balances[eigenId][eigenBalanceHolder[eigenId]]`.
///      When NFT ownership changes, `migrateBalance()` must be called to move the balance
///      slot to the new owner. This is a deliberate two-step design so that NFT transfers
///      auto-suspend the agent (keeper detects owner mismatch), and the new owner explicitly
///      claims the balance.
contract EigenVault is Ownable, ReentrancyGuard {

    address public keeper;

    /// @notice The ERC-8004 Identity Registry used for NFT-based ownership
    IIdentityRegistry8004 public immutable identityRegistry;

    // eigenId => user => ETH balance
    mapping(bytes32 => mapping(address => uint256)) public balances;

    // Total ETH held per eigen
    mapping(bytes32 => uint256) public eigenBalances;

    // Eigen status
    mapping(bytes32 => bool) public eigenActive;
    mapping(bytes32 => bool) public eigenTerminated;

    // Address-based ownership (used for legacy eigens AND as fallback for agent-owned eigens)
    mapping(bytes32 => address) public eigenOwner;

    // ERC-8004 agent ID per eigen (0 = legacy address-based ownership)
    mapping(bytes32 => uint256) public eigenAgentId;

    // Reverse mapping: agentId => eigenId (enforces 1:1 binding)
    mapping(uint256 => bytes32) public agentIdToEigen;

    // Tracks which address holds the balance slot for each eigen.
    // For agent-owned eigens this starts as the creator and must be migrated on NFT transfer.
    mapping(bytes32 => address) public eigenBalanceHolder;

    // Router whitelist
    mapping(address => bool) public approvedRouters;

    // Transfer lock — owner locks eigen before listing on marketplace
    mapping(bytes32 => bool) public transferLocked;

    uint256 public totalTrackedBalance;

    // Protocol fees settled via _settleFees awaiting owner claim
    uint256 public pendingProtocolFees;

    // ── Keeper Timelock ───────────────────────────────────────────────
    uint256 public constant KEEPER_TIMELOCK = 48 hours;
    address public pendingKeeper;
    uint256 public keeperChangeTimestamp;

    // ── Fee Configuration ─────────────────────────────────────────────
    uint256 public deployFeeBps;
    uint256 public constant MAX_DEPLOY_FEE_BPS = 2000;
    mapping(bytes32 => uint256) public eigenFeeRateBps;
    uint256 public constant MAX_TRADING_FEE_BPS = 1000;
    mapping(bytes32 => uint256) public feeOwed;

    // ── Per-Eigen Epoch Spending Limits ───────────────────────────────
    uint256 public constant SPEND_EPOCH = 1 hours;
    uint256 public spendLimitBps = 5000;
    mapping(bytes32 => uint256) public epochSpent;
    mapping(bytes32 => uint256) public epochStartTime;
    mapping(bytes32 => uint256) public epochStartBalance;

    // ── Per-Trade Max Spend Cap ─────────────────────────────────────
    uint256 public maxTradeSize = 5 ether;

    // ── User deposit tracking (for spend limit base) ────────────────
    mapping(bytes32 => uint256) public eigenDepositedPrincipal;

    // ── Events ────────────────────────────────────────────────────────

    event Deposited(bytes32 indexed eigenId, address indexed user, uint256 amount);
    event Withdrawn(bytes32 indexed eigenId, address indexed user, uint256 amount);
    event TradeExecuted(bytes32 indexed eigenId, uint256 ethSpent, address router);
    event EigenCreated(bytes32 indexed eigenId, address indexed owner, uint256 feeRateBps);
    event EigenCreatedWithAgent(bytes32 indexed eigenId, uint256 indexed agentId, uint256 feeRateBps);
    event EigenTerminated(bytes32 indexed eigenId, uint256 userPayout, uint256 feeSettled);
    event EigenSuspended(bytes32 indexed eigenId);
    event EigenResumed(bytes32 indexed eigenId);
    event KeeperUpdated(address indexed newKeeper);
    event FeeCollected(bytes32 indexed eigenId, uint256 amount);
    event FeeAccrued(bytes32 indexed eigenId, uint256 amount, uint256 totalOwed);
    event DeployFeeCollected(bytes32 indexed eigenId, uint256 amount);
    event DeployFeeUpdated(uint256 newFeeBps);
    event RouterApprovalUpdated(address indexed router, bool approved);
    event ETHRescued(uint256 amount);
    event EthReturned(bytes32 indexed eigenId, uint256 amount);
    event KeeperChangeProposed(address indexed newKeeper, uint256 effectiveAt);
    event KeeperChangeCancelled(address indexed cancelledKeeper);
    event SpendLimitUpdated(uint256 newLimitBps);
    event MaxTradeSizeUpdated(uint256 newMaxTradeSize);
    event BalanceMigrated(bytes32 indexed eigenId, address indexed from, address indexed to, uint256 amount);
    event ProtocolFeesClaimed(uint256 amount);
    event TransferLocked(bytes32 indexed eigenId);
    event TransferUnlocked(bytes32 indexed eigenId);

    // ── Modifiers ─────────────────────────────────────────────────────

    modifier onlyKeeper() {
        require(msg.sender == keeper, "Not keeper");
        _;
    }

    /// @notice Resolves the current owner of an eigen.
    ///         If the eigen has an 8004 agentId, ownership follows the NFT.
    ///         Otherwise uses the stored address.
    modifier onlyEigenOwner(bytes32 eigenId) {
        require(msg.sender == getEigenOwner(eigenId), "Not eigen owner");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────

    constructor(
        address _keeper,
        uint256 _deployFeeBps,
        address _identityRegistry
    ) Ownable(msg.sender) {
        require(_deployFeeBps <= MAX_DEPLOY_FEE_BPS, "Deploy fee too high");
        require(_identityRegistry != address(0), "Invalid registry");
        require(_keeper != address(0), "Invalid keeper");
        keeper = _keeper;
        deployFeeBps = _deployFeeBps;
        identityRegistry = IIdentityRegistry8004(_identityRegistry);
    }

    // ── Ownership Resolution ──────────────────────────────────────────

    /// @notice Get the current owner of an eigen. Dynamic — follows NFT transfers.
    ///         For agent-owned eigens, if the registry call fails, falls back to
    ///         eigenOwner (set to the creator at creation time).
    function getEigenOwner(bytes32 eigenId) public view returns (address) {
        uint256 agentId = eigenAgentId[eigenId];
        if (agentId != 0) {
            try identityRegistry.ownerOf(agentId) returns (address nftOwner) {
                if (nftOwner != address(0)) {
                    return nftOwner;
                }
            } catch {
                // Registry call failed — fall through to stored address
            }
        }
        return eigenOwner[eigenId];
    }

    /// @notice Get the address that currently holds the balance slot for an eigen.
    ///         For agent-owned eigens, this may differ from getEigenOwner if the NFT
    ///         was transferred but migrateBalance hasn't been called yet.
    function _getBalanceHolder(bytes32 eigenId) internal view returns (address) {
        address holder = eigenBalanceHolder[eigenId];
        if (holder != address(0)) return holder;
        return eigenOwner[eigenId];
    }

    // ── Transfer Lock ────────────────────────────────────────────

    /// @notice Lock eigen before listing on a marketplace. Suspends the agent
    ///         and blocks withdrawals so the buyer is guaranteed the vault balance.
    function lockForTransfer(bytes32 eigenId) external onlyEigenOwner(eigenId) {
        require(!eigenTerminated[eigenId], "Eigen terminated");
        require(!transferLocked[eigenId], "Already locked");
        transferLocked[eigenId] = true;
        eigenActive[eigenId] = false;
        emit TransferLocked(eigenId);
        emit EigenSuspended(eigenId);
    }

    /// @notice Cancel a transfer lock (owner changed their mind about selling).
    function unlockTransfer(bytes32 eigenId) external onlyEigenOwner(eigenId) {
        require(transferLocked[eigenId], "Not locked");
        transferLocked[eigenId] = false;
        emit TransferUnlocked(eigenId);
    }

    // ── Balance Migration ──────────────────────────────────────────

    /// @notice Migrate the balance slot from the old holder to the current NFT owner.
    ///         Must be called by the current eigen owner (the new NFT holder) after
    ///         an NFT transfer to claim the vault balance. Automatically unlocks.
    function migrateBalance(bytes32 eigenId) external nonReentrant onlyEigenOwner(eigenId) {
        require(!eigenTerminated[eigenId], "Eigen terminated");

        address currentOwner = getEigenOwner(eigenId);
        address oldHolder = _getBalanceHolder(eigenId);

        require(oldHolder != currentOwner, "Balance already migrated");

        uint256 amount = balances[eigenId][oldHolder];
        balances[eigenId][oldHolder] = 0;
        balances[eigenId][currentOwner] = amount;
        eigenBalanceHolder[eigenId] = currentOwner;
        eigenOwner[eigenId] = currentOwner; // Update fallback so registry downtime can't restore old owner

        // Auto-unlock after migration
        if (transferLocked[eigenId]) {
            transferLocked[eigenId] = false;
            emit TransferUnlocked(eigenId);
        }

        emit BalanceMigrated(eigenId, oldHolder, currentOwner, amount);
    }

    // ── Admin Functions ───────────────────────────────────────────────

    function setRouterApproval(address router, bool approved) external onlyOwner {
        approvedRouters[router] = approved;
        emit RouterApprovalUpdated(router, approved);
    }

    function setDeployFee(uint256 _deployFeeBps) external onlyOwner {
        require(_deployFeeBps <= MAX_DEPLOY_FEE_BPS, "Deploy fee too high");
        deployFeeBps = _deployFeeBps;
        emit DeployFeeUpdated(_deployFeeBps);
    }

    function proposeKeeper(address _keeper) external onlyOwner {
        require(_keeper != address(0), "Invalid keeper");
        pendingKeeper = _keeper;
        keeperChangeTimestamp = block.timestamp + KEEPER_TIMELOCK;
        emit KeeperChangeProposed(_keeper, keeperChangeTimestamp);
    }

    function executeKeeperChange() external onlyOwner {
        require(pendingKeeper != address(0), "No pending change");
        require(block.timestamp >= keeperChangeTimestamp, "Timelock not expired");
        keeper = pendingKeeper;
        pendingKeeper = address(0);
        keeperChangeTimestamp = 0;
        emit KeeperUpdated(keeper);
    }

    function cancelKeeperChange() external onlyOwner {
        require(pendingKeeper != address(0), "No pending change");
        address cancelled = pendingKeeper;
        pendingKeeper = address(0);
        keeperChangeTimestamp = 0;
        emit KeeperChangeCancelled(cancelled);
    }

    function setSpendLimit(uint256 _limitBps) external onlyOwner {
        require(_limitBps > 0 && _limitBps <= 10000, "Invalid limit");
        spendLimitBps = _limitBps;
        emit SpendLimitUpdated(_limitBps);
    }

    function setMaxTradeSize(uint256 _maxTradeSize) external onlyOwner {
        require(_maxTradeSize > 0, "Invalid max trade size");
        maxTradeSize = _maxTradeSize;
        emit MaxTradeSizeUpdated(_maxTradeSize);
    }

    // ── Bundler ──────────────────────────────────────────────────────

    address public approvedBundler;

    function setApprovedBundler(address _bundler) external onlyOwner {
        approvedBundler = _bundler;
    }

    // ── Ownership Rescue ─────────────────────────────────────────────

    /// @notice Fix eigens where the keeper was incorrectly set as owner.
    ///         Transfers ownership and balance slot to the intended owner.
    ///         Only callable by the keeper (the incorrect current owner).
    function rescueEigenOwnership(bytes32 eigenId, address intendedOwner) external nonReentrant onlyKeeper {
        require(eigenOwner[eigenId] == keeper, "Keeper is not owner");
        require(intendedOwner != address(0), "Invalid owner");
        require(!eigenTerminated[eigenId], "Eigen terminated");

        uint256 amount = balances[eigenId][keeper];
        balances[eigenId][keeper] = 0;
        balances[eigenId][intendedOwner] = amount;
        eigenOwner[eigenId] = intendedOwner;
        eigenBalanceHolder[eigenId] = intendedOwner;

        emit BalanceMigrated(eigenId, keeper, intendedOwner, amount);
    }

    // ── Eigen Lifecycle ───────────────────────────────────────────────

    /// @notice Create a new eigen with address-based ownership (legacy)
    function createEigen(bytes32 eigenId, uint256 tradingFeeBps) external payable nonReentrant {
        require(eigenOwner[eigenId] == address(0) && eigenAgentId[eigenId] == 0, "Eigen exists");
        require(msg.value > 0, "Must deposit ETH");
        require(tradingFeeBps <= MAX_TRADING_FEE_BPS, "Trading fee too high");

        uint256 fee = msg.value * deployFeeBps / 10000;
        uint256 userDeposit = msg.value - fee;
        require(userDeposit > 0, "Deposit too small");

        eigenOwner[eigenId] = msg.sender;
        eigenBalanceHolder[eigenId] = msg.sender;
        eigenActive[eigenId] = true;
        eigenFeeRateBps[eigenId] = tradingFeeBps;
        balances[eigenId][msg.sender] = userDeposit;
        eigenBalances[eigenId] = userDeposit;
        eigenDepositedPrincipal[eigenId] = userDeposit;
        totalTrackedBalance += userDeposit;

        // Route deploy fee to accumulator (avoids revert if owner() can't receive ETH)
        if (fee > 0) {
            pendingProtocolFees += fee;
            emit DeployFeeCollected(eigenId, fee);
        }

        emit EigenCreated(eigenId, msg.sender, tradingFeeBps);
        emit Deposited(eigenId, msg.sender, userDeposit);
    }

    /// @notice Create a new eigen with ERC-8004 NFT-based ownership.
    ///         The caller must own the specified agent NFT.
    function createEigenWithAgent(
        bytes32 eigenId,
        uint256 agentId,
        uint256 tradingFeeBps
    ) external payable nonReentrant {
        require(eigenOwner[eigenId] == address(0) && eigenAgentId[eigenId] == 0, "Eigen exists");
        require(msg.value > 0, "Must deposit ETH");
        require(tradingFeeBps <= MAX_TRADING_FEE_BPS, "Trading fee too high");
        require(agentId != 0, "Invalid agent ID");

        // Enforce 1:1 binding between agentId and eigenId
        require(agentIdToEigen[agentId] == bytes32(0), "Agent already bound");

        // Verify caller owns the agent NFT
        address nftOwner = identityRegistry.ownerOf(agentId);
        require(msg.sender == nftOwner, "Caller must own agent NFT");

        uint256 fee = msg.value * deployFeeBps / 10000;
        uint256 userDeposit = msg.value - fee;
        require(userDeposit > 0, "Deposit too small");

        eigenAgentId[eigenId] = agentId;
        agentIdToEigen[agentId] = eigenId;
        eigenOwner[eigenId] = msg.sender; // Fallback owner for registry failure
        eigenBalanceHolder[eigenId] = msg.sender;
        eigenActive[eigenId] = true;
        eigenFeeRateBps[eigenId] = tradingFeeBps;
        balances[eigenId][msg.sender] = userDeposit;
        eigenBalances[eigenId] = userDeposit;
        eigenDepositedPrincipal[eigenId] = userDeposit;
        totalTrackedBalance += userDeposit;

        // Route deploy fee to accumulator (avoids revert if owner() can't receive ETH)
        if (fee > 0) {
            pendingProtocolFees += fee;
            emit DeployFeeCollected(eigenId, fee);
        }

        emit EigenCreatedWithAgent(eigenId, agentId, tradingFeeBps);
        emit Deposited(eigenId, msg.sender, userDeposit);
    }

    /// @notice Create a new eigen on behalf of another address.
    ///         Callable by the approved bundler or the keeper.
    function createEigenFor(bytes32 eigenId, uint256 tradingFeeBps, address onBehalfOf) external payable nonReentrant {
        require(msg.sender == approvedBundler || msg.sender == keeper, "Not authorized");
        require(eigenOwner[eigenId] == address(0) && eigenAgentId[eigenId] == 0, "Eigen exists");
        require(msg.value > 0, "Must deposit ETH");
        require(tradingFeeBps <= MAX_TRADING_FEE_BPS, "Trading fee too high");
        require(onBehalfOf != address(0), "Invalid owner");

        uint256 fee = msg.value * deployFeeBps / 10000;
        uint256 userDeposit = msg.value - fee;
        require(userDeposit > 0, "Deposit too small");

        eigenOwner[eigenId] = onBehalfOf;
        eigenBalanceHolder[eigenId] = onBehalfOf;
        eigenActive[eigenId] = true;
        eigenFeeRateBps[eigenId] = tradingFeeBps;
        balances[eigenId][onBehalfOf] = userDeposit;
        eigenBalances[eigenId] = userDeposit;
        eigenDepositedPrincipal[eigenId] = userDeposit;
        totalTrackedBalance += userDeposit;

        // Route deploy fee to accumulator (avoids revert if owner() can't receive ETH)
        if (fee > 0) {
            pendingProtocolFees += fee;
            emit DeployFeeCollected(eigenId, fee);
        }

        emit EigenCreated(eigenId, onBehalfOf, tradingFeeBps);
        emit Deposited(eigenId, onBehalfOf, userDeposit);
    }

    /// @notice Create a new eigen with ERC-8004 agent binding on behalf of another address.
    ///         Callable by the approved bundler (EigenLauncher) or the keeper.
    ///         The caller must currently own the agent NFT (it mints and holds it temporarily,
    ///         then transfers it to onBehalfOf after vault creation).
    function createEigenForWithAgent(
        bytes32 eigenId,
        uint256 agentId,
        uint256 tradingFeeBps,
        address onBehalfOf
    ) external payable nonReentrant {
        require(msg.sender == approvedBundler || msg.sender == keeper, "Not authorized");
        require(eigenOwner[eigenId] == address(0) && eigenAgentId[eigenId] == 0, "Eigen exists");
        require(msg.value > 0, "Must deposit ETH");
        require(tradingFeeBps <= MAX_TRADING_FEE_BPS, "Trading fee too high");
        require(agentId != 0, "Invalid agent ID");
        require(onBehalfOf != address(0), "Invalid owner");
        require(agentIdToEigen[agentId] == bytes32(0), "Agent already bound");

        // Verify the bundler (EigenLauncher) currently owns the NFT
        address nftOwner = identityRegistry.ownerOf(agentId);
        require(nftOwner == msg.sender, "Bundler must own agent NFT");

        uint256 fee = msg.value * deployFeeBps / 10000;
        uint256 userDeposit = msg.value - fee;
        require(userDeposit > 0, "Deposit too small");

        eigenAgentId[eigenId] = agentId;
        agentIdToEigen[agentId] = eigenId;
        eigenOwner[eigenId] = onBehalfOf;
        eigenBalanceHolder[eigenId] = onBehalfOf;
        eigenActive[eigenId] = true;
        eigenFeeRateBps[eigenId] = tradingFeeBps;
        balances[eigenId][onBehalfOf] = userDeposit;
        eigenBalances[eigenId] = userDeposit;
        eigenDepositedPrincipal[eigenId] = userDeposit;
        totalTrackedBalance += userDeposit;

        if (fee > 0) {
            pendingProtocolFees += fee;
            emit DeployFeeCollected(eigenId, fee);
        }

        emit EigenCreatedWithAgent(eigenId, agentId, tradingFeeBps);
        emit Deposited(eigenId, onBehalfOf, userDeposit);
    }

    // ── Deposit / Withdraw ──────────────────────────────────────────

    /// @notice Deposit additional ETH to an existing eigen. Only callable by the current owner.
    function deposit(bytes32 eigenId) external payable nonReentrant onlyEigenOwner(eigenId) {
        require(eigenActive[eigenId], "Eigen not active");
        require(!eigenTerminated[eigenId], "Eigen terminated");
        require(msg.value > 0, "Must deposit ETH");

        address holder = _getBalanceHolder(eigenId);
        require(holder == msg.sender, "Balance migration required");
        balances[eigenId][holder] += msg.value;
        eigenBalances[eigenId] += msg.value;
        eigenDepositedPrincipal[eigenId] += msg.value;
        totalTrackedBalance += msg.value;

        emit Deposited(eigenId, msg.sender, msg.value);
    }

    function withdraw(bytes32 eigenId, uint256 amount) external nonReentrant onlyEigenOwner(eigenId) {
        require(!eigenTerminated[eigenId], "Eigen terminated");
        require(!transferLocked[eigenId], "Locked for transfer");

        // Block withdrawals if NFT transferred but balance not migrated yet
        // This prevents the old owner from front-running NFT sales to drain the vault
        address holder = _getBalanceHolder(eigenId);
        address currentOwner = getEigenOwner(eigenId);
        require(holder == currentOwner, "Balance migration required");

        _settleFees(eigenId);

        uint256 bal = balances[eigenId][holder];
        uint256 owed = feeOwed[eigenId];
        uint256 netBalance = bal > owed ? bal - owed : 0;
        require(amount > 0 && amount <= netBalance, "Exceeds net balance");

        balances[eigenId][holder] -= amount;
        eigenBalances[eigenId] -= amount;
        totalTrackedBalance -= amount;

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Transfer failed");

        emit Withdrawn(eigenId, msg.sender, amount);
    }

    /// @notice Keeper-initiated withdrawal. Sends funds to the eigen owner.
    ///         Used when the owner requests withdrawal via the off-chain API.
    function keeperWithdraw(bytes32 eigenId, uint256 amount) external nonReentrant onlyKeeper {
        require(!eigenTerminated[eigenId], "Eigen terminated");
        require(!transferLocked[eigenId], "Locked for transfer");

        address currentOwner = getEigenOwner(eigenId);
        address holder = _getBalanceHolder(eigenId);
        require(holder == currentOwner, "Balance migration required");

        _settleFees(eigenId);

        uint256 bal = balances[eigenId][holder];
        uint256 owed = feeOwed[eigenId];
        uint256 netBalance = bal > owed ? bal - owed : 0;
        require(amount > 0 && amount <= netBalance, "Exceeds net balance");

        balances[eigenId][holder] -= amount;
        eigenBalances[eigenId] -= amount;
        totalTrackedBalance -= amount;

        (bool sent, ) = currentOwner.call{value: amount}("");
        require(sent, "Transfer failed");

        emit Withdrawn(eigenId, currentOwner, amount);
    }

    /// @notice Keeper-initiated withdrawal of entire net balance. Settles fees
    ///         internally and withdraws the maximum available, avoiding TOCTOU races.
    function keeperWithdrawAll(bytes32 eigenId) external nonReentrant onlyKeeper returns (uint256 withdrawn) {
        require(!eigenTerminated[eigenId], "Eigen terminated");
        require(!transferLocked[eigenId], "Locked for transfer");

        address currentOwner = getEigenOwner(eigenId);
        address holder = _getBalanceHolder(eigenId);
        require(holder == currentOwner, "Balance migration required");

        _settleFees(eigenId);

        uint256 bal = balances[eigenId][holder];
        uint256 owed = feeOwed[eigenId];
        withdrawn = bal > owed ? bal - owed : 0;
        require(withdrawn > 0, "No balance to withdraw");

        balances[eigenId][holder] -= withdrawn;
        eigenBalances[eigenId] -= withdrawn;
        totalTrackedBalance -= withdrawn;

        (bool sent, ) = currentOwner.call{value: withdrawn}("");
        require(sent, "Transfer failed");

        emit Withdrawn(eigenId, currentOwner, withdrawn);
    }

    // ── Suspend / Resume / Terminate ────────────────────────────────

    function suspend(bytes32 eigenId) external onlyEigenOwner(eigenId) {
        require(eigenActive[eigenId], "Not active");
        eigenActive[eigenId] = false;
        emit EigenSuspended(eigenId);
    }

    function resume(bytes32 eigenId) external onlyEigenOwner(eigenId) {
        require(!eigenActive[eigenId], "Already active");
        require(!eigenTerminated[eigenId], "Eigen terminated");
        eigenActive[eigenId] = true;
        emit EigenResumed(eigenId);
    }

    /// @notice Terminate eigen — settles accrued fees, sends remainder to user.
    function terminate(bytes32 eigenId) external nonReentrant onlyEigenOwner(eigenId) {
        require(!eigenTerminated[eigenId], "Already terminated");
        require(!transferLocked[eigenId], "Locked for transfer");

        // Block terminate if NFT transferred but balance not migrated
        address holder = _getBalanceHolder(eigenId);
        require(holder == getEigenOwner(eigenId), "Balance migration required");
        uint256 balance = balances[eigenId][holder];
        uint256 owed = feeOwed[eigenId];

        // Settle fees: route to pendingProtocolFees (claimable via claimProtocolFees)
        // This avoids direct transfer to owner() which could revert and lock user funds.
        uint256 feeToSettle = owed > balance ? balance : owed;
        uint256 userPayout = balance - feeToSettle;

        eigenActive[eigenId] = false;
        eigenTerminated[eigenId] = true;
        balances[eigenId][holder] = 0;
        eigenBalances[eigenId] = 0;
        feeOwed[eigenId] = 0;

        totalTrackedBalance -= balance;

        if (feeToSettle > 0) {
            pendingProtocolFees += feeToSettle;
            emit FeeCollected(eigenId, feeToSettle);
        }

        if (userPayout > 0) {
            (bool sent, ) = msg.sender.call{value: userPayout}("");
            require(sent, "User transfer failed");
        }

        emit EigenTerminated(eigenId, userPayout, feeToSettle);
    }

    /// @notice Keeper-initiated termination. Settles fees and sends remainder to the eigen owner.
    ///         Used when the owner has requested termination via the off-chain API.
    function keeperTerminate(bytes32 eigenId) external nonReentrant onlyKeeper {
        require(!eigenTerminated[eigenId], "Already terminated");
        require(!transferLocked[eigenId], "Locked for transfer");

        address currentOwner = getEigenOwner(eigenId);
        address holder = _getBalanceHolder(eigenId);
        require(holder == currentOwner, "Balance migration required");
        uint256 balance = balances[eigenId][holder];
        uint256 owed = feeOwed[eigenId];

        uint256 feeToSettle = owed > balance ? balance : owed;
        uint256 userPayout = balance - feeToSettle;

        eigenActive[eigenId] = false;
        eigenTerminated[eigenId] = true;
        balances[eigenId][holder] = 0;
        eigenBalances[eigenId] = 0;
        feeOwed[eigenId] = 0;
        totalTrackedBalance -= balance;

        if (feeToSettle > 0) {
            pendingProtocolFees += feeToSettle;
            emit FeeCollected(eigenId, feeToSettle);
        }

        if (userPayout > 0) {
            (bool sent, ) = currentOwner.call{value: userPayout}("");
            require(sent, "User transfer failed");
        }

        emit EigenTerminated(eigenId, userPayout, feeToSettle);
    }

    // ── Keeper Trade Execution ──────────────────────────────────────

    function executeBuy(
        bytes32 eigenId,
        address router,
        bytes calldata swapData,
        uint256 ethAmount
    ) external onlyKeeper nonReentrant {
        require(eigenActive[eigenId], "Eigen not active");
        require(approvedRouters[router], "Router not approved");
        require(ethAmount <= eigenBalances[eigenId], "Insufficient balance");
        require(ethAmount <= maxTradeSize, "Exceeds max trade size");

        // Epoch spending limit check (based on deposited principal, not current balance)
        _checkSpendLimit(eigenId, ethAmount);

        // Accrue trading fee (before external call — checks-effects-interactions)
        uint256 feeRate = eigenFeeRateBps[eigenId];
        uint256 fee = ethAmount * feeRate / 10000;
        if (fee > 0) {
            feeOwed[eigenId] += fee;
            emit FeeAccrued(eigenId, fee, feeOwed[eigenId]);
        }

        eigenBalances[eigenId] -= ethAmount;
        address holder = _getBalanceHolder(eigenId);
        balances[eigenId][holder] -= ethAmount;
        totalTrackedBalance -= ethAmount;

        (bool sent, ) = router.call{value: ethAmount}(swapData);
        require(sent, "Swap failed");

        emit TradeExecuted(eigenId, ethAmount, router);
    }

    /// @notice Keeper returns ETH from a sell operation.
    function returnEth(bytes32 eigenId) external payable onlyKeeper nonReentrant {
        require(msg.value > 0, "Must return ETH");
        require(!eigenTerminated[eigenId], "Eigen terminated");
        address holder = _getBalanceHolder(eigenId);
        balances[eigenId][holder] += msg.value;
        eigenBalances[eigenId] += msg.value;
        totalTrackedBalance += msg.value;
        emit EthReturned(eigenId, msg.value);
    }

    // ── Fee Management ──────────────────────────────────────────────

    /// @notice Owner manually collects accrued fees from an eigen.
    ///         Collects up to available balance.
    function collectFee(bytes32 eigenId) external onlyOwner nonReentrant {
        uint256 owed = feeOwed[eigenId];
        require(owed > 0, "No fees owed");

        uint256 available = eigenBalances[eigenId];
        uint256 toCollect = owed > available ? available : owed;

        address holder = _getBalanceHolder(eigenId);
        balances[eigenId][holder] -= toCollect;
        eigenBalances[eigenId] -= toCollect;
        totalTrackedBalance -= toCollect;
        feeOwed[eigenId] -= toCollect;

        (bool sent, ) = owner().call{value: toCollect}("");
        require(sent, "Fee transfer failed");

        emit FeeCollected(eigenId, toCollect);
    }

    // ── View Functions ──────────────────────────────────────────────

    function getEigenInfo(bytes32 eigenId) external view returns (
        address ownerAddr,
        bool active,
        uint256 balance
    ) {
        ownerAddr = getEigenOwner(eigenId);
        active = eigenActive[eigenId];
        balance = eigenBalances[eigenId];
    }

    function getNetBalance(bytes32 eigenId) external view returns (uint256) {
        uint256 gross = eigenBalances[eigenId];
        uint256 fees = feeOwed[eigenId];
        return gross > fees ? gross - fees : 0;
    }

    // ── Internal Functions ──────────────────────────────────────────

    /// @notice Settle accrued fees by deducting from the balance holder's slot.
    ///         Settled fees go to pendingProtocolFees accumulator
    ///         (claimable via claimProtocolFees).
    function _settleFees(bytes32 eigenId) internal {
        uint256 fees = feeOwed[eigenId];
        if (fees == 0) return;

        address holder = _getBalanceHolder(eigenId);
        uint256 available = balances[eigenId][holder];
        uint256 toSettle = fees > available ? available : fees;

        if (toSettle > 0) {
            balances[eigenId][holder] -= toSettle;
            eigenBalances[eigenId] -= toSettle;
            totalTrackedBalance -= toSettle;
            feeOwed[eigenId] -= toSettle;
            pendingProtocolFees += toSettle;
            emit FeeCollected(eigenId, toSettle);
        }
    }

    function _checkSpendLimit(bytes32 eigenId, uint256 amount) internal {
        uint256 epoch = block.timestamp / SPEND_EPOCH;
        uint256 currentEpoch = epochStartTime[eigenId];

        if (epoch != currentEpoch || epochStartBalance[eigenId] == 0) {
            epochStartTime[eigenId] = epoch;
            epochSpent[eigenId] = 0;
            // Use deposited principal as base (immune to returnEth inflation)
            uint256 principal = eigenDepositedPrincipal[eigenId];
            uint256 currentBal = eigenBalances[eigenId];
            epochStartBalance[eigenId] = principal > 0 && principal < currentBal ? principal : currentBal;
        }

        uint256 limit = epochStartBalance[eigenId] * spendLimitBps / 10000;
        require(epochSpent[eigenId] + amount <= limit, "Epoch spend limit exceeded");
        epochSpent[eigenId] += amount;
    }

    // ── Protocol Fee Claim ────────────────────────────────────────

    /// @notice Claim protocol fees settled via _settleFees (during withdraw/terminate).
    ///         Separate from collectFee (which collects directly from feeOwed).
    function claimProtocolFees() external onlyOwner nonReentrant {
        uint256 amount = pendingProtocolFees;
        require(amount > 0, "No fees to claim");
        pendingProtocolFees = 0;

        (bool sent, ) = owner().call{value: amount}("");
        require(sent, "Transfer failed");
        emit ProtocolFeesClaimed(amount);
    }

    // ── Rescue ──────────────────────────────────────────────────────

    /// @notice Recover ETH not tracked by any eigen or pending fees.
    function rescueETH() external onlyOwner nonReentrant {
        uint256 excess = address(this).balance - totalTrackedBalance - pendingProtocolFees;
        require(excess > 0, "No excess ETH");
        (bool sent, ) = owner().call{value: excess}("");
        require(sent, "Rescue failed");
        emit ETHRescued(excess);
    }

    receive() external payable {}
}
