// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./Deposits.sol";

// Staking distributes the rewards based on deposited tokens to each user.
//
contract Staking is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Info of each pool.
    struct PoolInfo {
        IERC20 token;               // Address of token contract.
        uint256 rewardPerToken;     // Number of ERC20 per token, times 1e36
    }

    Deposits deposits;

    // Address of the reward ERC20 Token contract.
    IERC20 public erc20;
    // The total amount of ERC20 that's paid out as reward.
    uint256 public paidOut = 0;
    // The total amount of ERC20 that's burned as a penalty.
    uint256 public burned = 0;
    // ERC20 tokens rewarded per block.
    uint256 public rewardPerBlock;

    // Info of each pool.
    PoolInfo[] public poolInfo;

    // The block number when staking starts.
    uint256 public startBlock;
    // The block number when staking program ends.
    uint256 public endBlock;
    // The number of blocks until the soft lock ends.
    uint256 public softLockBlocks;

    event Harvest(address indexed user, uint256 amount);

    constructor(Deposits _deposits, IERC20 _erc20, uint256 _startBlock, uint256 _duration, uint256 _softLockBlocks) public {
        deposits = _deposits;
        erc20 = _erc20;
        startBlock = _startBlock;
        endBlock = _startBlock + _duration;
        softLockBlocks = _softLockBlocks;
    }

    // Number of tokens pools
    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // End the program immediately. This can be done to replace the staking program while keeping the deposits.
    function terminate() public onlyOwner {
        endBlock = block.number;
    }

    // Add a new token to the pool. Can only be called by the owner. Must be done before the program starts.
    function add(IERC20 _token, uint256 _rewardAmount, uint256 _rewardDivider) public onlyOwner {
        require(block.number < startBlock, "Unable to add new token, the program has already started");

        poolInfo.push(PoolInfo({
            token: _token,
            rewardPerToken: (_rewardAmount * 1e36) / _rewardDivider
        }));
    }

    // View function to see pending reward for a user.
    function pending(address _user) public view returns (uint256) {
        uint256 reward = 0;
        uint256 length = poolInfo.length;

        for (uint256 pid = 0; pid < length; ++pid) {
            reward += this.pendingPool(pid, _user);
        }

        return reward;
    }

    // View function to see pending rewards for a user for a specific pool.
    function pendingPool(uint256 _pid, address _user) public view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        uint256 lastBlock = block.number < endBlock ? block.number : endBlock;

        return deposits.calcReward(pool.token, _user, pool.rewardPerToken, startBlock, lastBlock).div(1e36);
    }

    // Deposit tokens to contract for staking rewards.
    function deposit(uint256 _pid, uint256 _amount) public {
        require(block.number < endBlock, "Sorry, the staking program has ended");

        deposits.deposit(poolInfo[_pid].token, _amount);
    }

    // Withdraw all tokens and rewards.
    function withdraw() public {
        uint256 reward = pending(msg.sender);

        payoutReward(msg.sender, reward);
        deposits.withdrawWithoutReward();
    }

    // Only withdraw the rewards.
    function harvest() public {
        uint256 reward = pending(msg.sender);

        payoutReward(msg.sender, reward);
    }

    // Transfer reward from owner to
    function payoutReward(address _to, uint256 _amount) internal {
        erc20.safeTransferFrom(owner(), _to, _amount);
        paidOut += _amount;

        emit Harvest(_to, _amount);
    }
}
