// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Staking distributes the rewards based on deposited tokens to each user.
//
contract Staking is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Info of each user.
    struct UserInfo {
        uint256 amount;        // How many pool tokens the user has provided.
        uint256 rewardDebt;    // Reward debt. See explanation below.
        uint256 pendingReward; // Fixed reward hold for the user.
    }

    // Info of each pool.
    struct PoolInfo {
        IERC20 token;               // Address of token contract.
        uint256 rewardPerToken;     // Number of ERC20 per token, times 1e36
        uint256 lastRewardBlock;    // Last block number that ERC20s distribution occurs.
        uint256 accRewardPerToken;  // Accumulated ERC20 per token, times 1e36.
    }

    // Address of the reward ERC20 Token contract.
    IERC20 public erc20;
    // The total amount of ERC20 that's funded.
    uint256 public funded = 0;
    // The total amount of ERC20 that's paid out as reward.
    uint256 public paidOut = 0;
    // The total amount of ERC20 that's burned as a penalty.
    uint256 public burned = 0;
    // ERC20 tokens rewarded per block.
    uint256 public rewardPerBlock;

    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Info of each user that stakes tokens.
    mapping (uint256 => mapping (address => UserInfo)) public userInfo;

    // The block number when staking starts.
    uint256 public startBlock;
    // The block number when staking program ends.
    uint256 public endBlock;
    // The number of blocks until the soft lock ends.
    uint256 public softLockBlocks;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);

    constructor(IERC20 _erc20, uint256 _startBlock, uint256 _softLockBlocks) public {
        erc20 = _erc20;
        startBlock = _startBlock;
        endBlock = _startBlock;
        softLockBlocks = _softLockBlocks;
    }

    // Number of tokens pools
    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Fund the contract, increase the end block
    function fund(uint256 _amount) public {
        require(block.number < endBlock, "fund: too late, the contract is closed");

        erc20.safeTransferFrom(address(msg.sender), address(this), _amount);
        funded += _amount;
    }

    // View function to see pending reward for a user.
    function pending(address _user) external view returns (uint256) {
        uint256 reward = 0;
        uint256 length = poolInfo.length;

        for (uint256 pid = 0; pid < length; ++pid) {
            reward += 0;//this.pendingPool(pid, _user);
        }

        return reward;
    }

    // Add a new lp to the pool. Can only be called by the owner.
    // DO NOT add the same pool token more than once. Rewards will be messed up if you do.
    function add(IERC20 _token, uint256 _rewardAmount, uint256 _rewardDivider) public onlyOwner {
        if (block.number > startBlock) {
            massUpdatePools();
        }

        uint256 lastRewardBlock = block.number > startBlock ? block.number : startBlock;
        poolInfo.push(PoolInfo({
            token: _token,
            rewardPerToken: (_rewardAmount * 1e36) / _rewardDivider,
            lastRewardBlock: lastRewardBlock,
            accRewardPerToken: 0
        }));
    }

    // Update the given pool's reward per token. Can only be called by the owner.
    function set(uint256 _pid, uint256 _rewardAmount, uint256 _rewardDivider) public onlyOwner {
        if (block.number > startBlock) {
            massUpdatePools();
        }
        poolInfo[_pid].rewardPerToken = (_rewardAmount * 1e36) / _rewardDivider;
    }

    // View function to see deposited tokens for a user.
    function deposited(uint256 _pid, address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_pid][_user];
        return user.amount;
    }

    // View function to see pending ERC20s for a user.
    function pendingPool(uint256 _pid, address _user) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accRewardPerToken = pool.accRewardPerToken;
        uint256 supply = pool.token.balanceOf(address(this));

        if (block.number > pool.lastRewardBlock && supply != 0) {
            uint256 lastBlock = block.number < endBlock ? block.number : endBlock;
            uint256 nrOfBlocks = lastBlock.sub(pool.lastRewardBlock);
            uint256 erc20Reward = 0;//nrOfBlocks.mul(rewardPerBlock).mul(pool.allocPoint).div(totalAllocPoint);
            accRewardPerToken = accRewardPerToken.add(erc20Reward.mul(1e36).div(supply));
        }

        return user.amount.mul(accRewardPerToken).div(1e36).sub(user.rewardDebt);
    }

    // View function for total reward the contract has yet to pay out.
    function totalPending() external view returns (uint256) {
        if (block.number <= startBlock) {
            return 0;
        }

        uint256 lastBlock = block.number < endBlock ? block.number : endBlock;
        return rewardPerBlock.mul(lastBlock - startBlock).sub(paidOut);
    }

    // Update reward variables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        uint256 lastBlock = block.number < endBlock ? block.number : endBlock;

        if (lastBlock <= pool.lastRewardBlock) {
            return;
        }
        uint256 supply = pool.token.balanceOf(address(this));
        if (supply == 0) {
            pool.lastRewardBlock = lastBlock;
            return;
        }

        uint256 nrOfBlocks = lastBlock.sub(pool.lastRewardBlock);
        uint256 erc20Reward = nrOfBlocks.mul(rewardPerBlock).mul(pool.rewardPerToken);

        pool.accRewardPerToken = pool.accRewardPerToken.add(erc20Reward.mul(1e36).div(supply));
        pool.lastRewardBlock = block.number;
    }

    // Deposit pool tokens to contract for ERC20 allocation.
    function deposit(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        updatePool(_pid);
        if (user.amount > 0) {
            uint256 pendingAmount = user.amount.mul(pool.accRewardPerToken).div(1e36).sub(user.rewardDebt);
            erc20Transfer(msg.sender, pendingAmount);
        }
        pool.token.safeTransferFrom(address(msg.sender), address(this), _amount);
        user.amount = user.amount.add(_amount);
        user.rewardDebt = user.amount.mul(pool.accRewardPerToken).div(1e36);
        emit Deposit(msg.sender, _pid, _amount);
    }

    // Withdraw pool tokens from contract.
    function withdraw(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "withdraw: can't withdraw more than deposit");
        updatePool(_pid);
        uint256 pendingAmount = user.amount.mul(pool.accRewardPerToken).div(1e36).sub(user.rewardDebt);
        erc20Transfer(msg.sender, pendingAmount);
        user.amount = user.amount.sub(_amount);
        user.rewardDebt = user.amount.mul(pool.accRewardPerToken).div(1e36);
        pool.token.safeTransfer(address(msg.sender), _amount);
        emit Withdraw(msg.sender, _pid, _amount);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        pool.token.safeTransfer(address(msg.sender), user.amount);
        emit EmergencyWithdraw(msg.sender, _pid, user.amount);
        user.amount = 0;
        user.rewardDebt = 0;
    }

    // Transfer ERC20 and update the required ERC20 to payout all rewards
    function erc20Transfer(address _to, uint256 _amount) internal {
        erc20.transfer(_to, _amount);
        paidOut += _amount;
    }
}
