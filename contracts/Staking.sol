// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./Deposits.sol";

// Staking distributes the rewards based on deposited tokens to each user.
//
contract Staking is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for ERC20Burnable;

    // Info of each pool.
    struct PoolInfo {
        IERC20 token;               // Address of token contract.
        uint256 rewardPerToken;     // Number of ERC20 per token, times 1e36
    }

    // The Deposits contract that holds the staked tokens of the users.
    Deposits public deposits;

    // Addresses that have harvested the contract. This can be done only once.
    mapping (address => bool) public harvested;

    // Address of the reward ERC20 Token contract.
    ERC20Burnable public erc20;
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
    // The block number when the soft lock ends.
    uint256 public softLockBlock;

    event Harvest(address indexed user, uint256 amount);

    constructor(Deposits _deposits, ERC20Burnable _erc20, uint256 _startBlock, uint256 _endBlock, uint256 _softLockBlock) public {
        require(_startBlock <- _endBlock);
        require(_startBlock <= _softLockBlock);
        require(_softLockBlock <= _endBlock);

        deposits = _deposits;
        erc20 = _erc20;
        startBlock = _startBlock;
        endBlock = _endBlock;
        softLockBlock = _softLockBlock;
    }

    // Number of tokens pools
    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Extend the duration of the program.
    function extend(uint256 _blocks) public onlyOwner {
        require(block.number < endBlock, "The staking program has already ended");

        endBlock = endBlock.add(_blocks);
    }

    // End the program immediately. This can be done to replace the staking program while keeping the deposits.
    function terminate() public onlyOwner {
        endBlock = block.number;

        if (softLockBlock > endBlock) {
            softLockBlock = endBlock;
        }
    }

    // Add a new token to the pool. Can only be called by the owner. Must be done before the program starts.
    function add(IERC20 _token, uint256 _rewardAmount, uint256 _rewardDivider) public onlyOwner {
        require(block.number < startBlock, "Unable to add new token, the program has already started");

        poolInfo.push(PoolInfo({
            token: _token,
            rewardPerToken: (_rewardAmount * 1e36) / _rewardDivider
        }));
    }

    // Return the penalty (times 10^36)
    function penalty() public view returns (uint256) {
        if (block.number >= softLockBlock) {
            return 0;
        }

        if (block.number < startBlock) {
            return 1e10;
        }

        return (softLockBlock - block.number).mul(1e36).div(softLockBlock - startBlock);
    }

    // View function to see pending reward for a user.
    function pending(address _user) public view returns (uint256) {
        uint256 reward = 0;
        uint256 length = poolInfo.length;

        if (harvested[_user]) {
            return 0;
        }

        for (uint256 pid = 0; pid < length; ++pid) {
            reward = reward.add(this.pendingPool(pid, _user));
        }

        return reward;
    }

    // View function to see pending rewards for a user for a specific pool.
    function pendingPool(uint256 _pid, address _user) public view returns (uint256) {
        if (block.number < startBlock) {
            return 0;
        }

        PoolInfo storage pool = poolInfo[_pid];
        uint256 lastBlock = block.number < endBlock ? block.number : endBlock;

        return deposits.calcReward(pool.token, _user, pool.rewardPerToken, startBlock, lastBlock).div(1e36);
    }

    // Withdraw the rewards from the staking contract. The deposits stays untouched.
    // This is only allowed when the program has ended.
    function harvest() public {
        require(block.number >= endBlock, "It's not allowed to harvest only the rewards when the program is running");

        uint256 reward = pending(msg.sender);
        require(reward > 0, "There is no pending reward for this wallet address");

        harvested[msg.sender] = true;
        erc20.safeTransferFrom(owner(), msg.sender, reward);
        paidOut = paidOut.add(reward);

        emit Harvest(msg.sender, reward);
    }

    // Withdraw both the deposits and the rewards.
    function withdraw() public {
        uint256 reward = pending(msg.sender);
        uint256 burn = reward.mul(penalty()).div(1e36);
        uint256 payout = reward.sub(burn);

        if (burn > 0) {
            erc20.burnFrom(owner(), burn);
            burned = burned.add(burn);
        }

        if (reward > 0) {
            erc20.safeTransferFrom(owner(), msg.sender, payout);
            paidOut = paidOut.add(payout);

            emit Harvest(msg.sender, payout);
        }

        deposits.withdrawForUser(msg.sender);
    }
}
