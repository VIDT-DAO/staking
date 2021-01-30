// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./Staking.sol";

// Deposits holds deposits for each user.
//
contract Deposits is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 MAX_INT = uint256(-1);

    struct capInfo {
        IERC20 referenceToken;
        uint256 referenceAmount;
        uint256 cappedAmount;
    }

    // Info of each deposit.
    struct DepositInfo {
        IERC20 token;   // Address of token contract.
        uint256 amount; // Amount deposited.
        uint256 block;  // Block that the amount was deposited.
    }

    // List of trusted addresses
    mapping (address => bool) public trusted;

    mapping (IERC20 => capInfo) public caps;

    mapping (IERC20 => uint256) public limits;

    // List of deposits of each user.
    mapping (address => DepositInfo[]) public deposits;
    // Total deposit per token.
    mapping (IERC20 => uint256) public totals;

    event Deposit(address indexed user, IERC20 indexed token, uint256 amount);
    event Withdraw(address indexed user, IERC20 indexed token, uint256 amount);

    modifier onlyTrusted() {
        require(trusted[msg.sender], "this call can only be done by the staking contract");
        _;
    }

    // Trust an address to do a call for a user
    function trust(address _address) public onlyOwner {
        trusted[_address] = true;
    }

    // Revoke the trust of address to do a call for a user.
    function revokeTrust(address _address) public onlyOwner {
        delete trusted[_address];
    }

    // Set the maximum amount of tokens that can be deposited foreach reference token.
    function cap(IERC20 _referenceToken, uint256 _referenceAmount, IERC20 _cappedToken, uint256 _cappedAmount) public onlyOwner {
        caps[_cappedToken] = capInfo({
            referenceToken: _referenceToken,
            referenceAmount: _referenceAmount,
            cappedAmount: _cappedAmount
        });
    }

    // Remove the cap of a token.
    function uncap(IERC20 _cappedToken) public onlyOwner {
        delete caps[_cappedToken];
    }

    // Configure a limit of the total number of a token that the can be deposited (by all users).
    // Set to 0 to remove the limit.
    function limit(IERC20 _token, uint256 _limit) public onlyOwner {
        limits[_token] = _limit;
    }

    // View function to see deposited tokens.
    function total(IERC20 _token) external view returns (uint256) {
        return totals[_token];
    }

    // View function to see deposited tokens for a user.
    function deposited(IERC20 _token, address _user) public view returns (uint256) {
        DepositInfo[] storage userDeposits = deposits[_user];
        uint256 length = userDeposits.length;
        uint256 amount = 0;

        for (uint256 n = 0; n < length; ++n) {
            if (userDeposits[n].token == _token) {
                amount += userDeposits[n].amount;
            }
        }

        return amount;
    }

    // The maximum amount of capped tokens the user is still allowed to deposit.
    function maxDeposit(IERC20 _token, address _user) public view returns (uint256) {
        if (caps[_token].referenceAmount == 0) {
            return MAX_INT;
        }

        (uint256 maxAmount, uint256 depositedAmount) = depositedCapped(_token, _user);

        return depositedAmount < maxAmount ? maxAmount.sub(depositedAmount) : 0;
    }

    // Get the maximum amount the user is allowed to deposit and the amount the user has deposited of a capped token.
    function depositedCapped(IERC20 _token, address _user) public view returns (uint256, uint256) {
        capInfo storage info = caps[_token];
        uint256 depositedAmount = deposited(_token, _user);

        if (info.referenceAmount == 0) {
            return (MAX_INT, depositedAmount);
        }

        uint256 depositedReference = deposited(info.referenceToken, _user);
        uint256 maxAmount = depositedReference.mul(info.cappedAmount).div(info.referenceAmount);

        return (maxAmount, depositedAmount);
    }

    // Calculate the reward a user should receive for a specific token.
    function calcReward(IERC20 _token, address _user, uint256 _rewardPerToken, uint256 _startBlock, uint256 _endBlock) public view returns (uint256) {
        DepositInfo[] storage userDeposits = deposits[_user];
        uint256 length = userDeposits.length;
        uint256 reward = 0;

        for (uint256 n = 0; n < length; ++n) {
            if (userDeposits[n].token != _token) continue;

            uint256 firstBlock = _startBlock < userDeposits[n].block ? userDeposits[n].block : _startBlock;
            reward = reward.add(userDeposits[n].amount.mul(_rewardPerToken).mul(_endBlock - firstBlock));
        }

        return reward;
    }

    // Deposit tokens to the contract.
    function deposit(IERC20 _token, uint256 _amount) public {
        _deposit(_token, _amount);
        _assertDeposit(_token);
    }

    // Alias of deposit
    function deposit1(IERC20 _token, uint256 _amount) public {
        _deposit(_token, _amount);
        _assertDeposit(_token);
    }

    // Deposit two sets of tokens in one transaction
    function deposit2(IERC20 _token1, uint256 _amount1, IERC20 _token2, uint256 _amount2) public {
        _deposit(_token1, _amount1);
        _deposit(_token2, _amount2);

        _assertDeposit(_token1);
        _assertDeposit(_token2);
    }

    // Deposit three sets of tokens in one transaction
    function deposit3(IERC20 _token1, uint256 _amount1, IERC20 _token2, uint256 _amount2, IERC20 _token3, uint256 _amount3) public {
        _deposit(_token1, _amount1);
        _deposit(_token2, _amount2);
        _deposit(_token3, _amount3);

        _assertDeposit(_token1);
        _assertDeposit(_token2);
        _assertDeposit(_token3);
    }

    // Internal call to deposit tokens.
    function _deposit(IERC20 _token, uint256 _amount) internal {
        _token.approve(address(this), _amount);
        _token.safeTransferFrom(address(msg.sender), address(this), _amount);

        deposits[msg.sender].push(DepositInfo({
            token: _token,
            amount: _amount,
            block: block.number
        }));

        totals[_token] = totals[_token].add(_amount);

        emit Deposit(msg.sender, _token, _amount);
    }

    // Assert that the amount deposited is within the limits allowed.
    function _assertDeposit(IERC20 _token) internal view {
        require(limits[_token] == 0 || totals[_token] <= limits[_token], "Limit reached");

        if (caps[_token].referenceAmount != 0) {
            (uint256 maxAmount, uint256 depositedAmount) = depositedCapped(_token, msg.sender);
            require(maxAmount >= depositedAmount, "Not allowed to deposit specified amount of capped token");
        }
    }

    // Withdraw all tokens from the contract.
    // Withdrawing direct from the Deposit contract, means you won't receive any rewards.
    function withdraw() public {
        _withdraw(msg.sender);
    }

    // Send all deposited tokens from the contract back to the user.
    // This can only be called by trusted addresses, typically a staking contract.
    function withdrawForUser(address _user) public onlyTrusted {
        _withdraw(_user);
    }

    // Internal call to withdraw tokens.
    function _withdraw(address _user) internal {
        DepositInfo[] storage userDeposits = deposits[_user];
        uint256 length = userDeposits.length;

        for (uint256 n = 0; n < length; ++n) {
            IERC20 token = userDeposits[n].token;
            uint256 amount = userDeposits[n].amount;

            token.safeTransfer(_user, amount);
            totals[token] = totals[token].sub(amount);

            emit Withdraw(_user, token, amount);
        }

        delete deposits[_user];
    }
}
