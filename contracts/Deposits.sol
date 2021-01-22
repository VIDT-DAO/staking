// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Deposits holds deposits for each user.
//
contract Deposits is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Info of each deposit.
    struct DepositInfo {
        IERC20 token;   // Address of token contract.
        uint256 amount; // Amount deposited.
        uint256 block;  // Block that the amount was deposited.
    }

    // List of deposits of each user.
    mapping (address => DepositInfo[]) public deposits;
    mapping (IERC20 => uint256) public totals;

    event Deposit(address indexed user, IERC20 indexed token, uint256 amount);
    event Withdraw(address indexed user, IERC20 indexed token, uint256 amount);

    // View function to see deposited tokens.
    function total(IERC20 _token) external view returns (uint256) {
        return totals[_token];
    }

    // View function to see deposited tokens for a user.
    function deposited(IERC20 _token, address _user) external view returns (uint256) {
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

    // Deposit pool tokens to contract for ERC20 allocation.
    function deposit(IERC20 _token, uint256 _amount) public {
        _token.safeTransferFrom(address(msg.sender), address(this), _amount);

        deposits[msg.sender].push(DepositInfo({
            token: _token,
            amount: _amount,
            block: block.number
        }));

        totals[_token] = totals[_token].add(_amount);

        emit Deposit(msg.sender, _token, _amount);
    }

    // Withdraw without caring about rewards.
    function withdrawWithoutReward() public {
        DepositInfo[] storage userDeposits = deposits[msg.sender];
        uint256 length = userDeposits.length;

        for (uint256 n = 0; n < length; ++n) {
            IERC20 token = userDeposits[n].token;
            uint256 amount = userDeposits[n].amount;

            token.safeTransfer(address(msg.sender), amount);
            totals[token] = totals[token].sub(amount);

            emit Withdraw(msg.sender, token, amount);
        }

        delete deposits[msg.sender];
    }
}
