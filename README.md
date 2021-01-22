# VIDT staking
![Mock screen](https://user-images.githubusercontent.com/100821/105279406-c05e3e80-5ba7-11eb-9c97-d4fff8c6a8ef.jpeg)

# Quickstart

## Installation

```
npm install
```

## Run tests

```
npm test
```

## Configuration

Create a `.env` file with keys

```
MNEMONIC="..."
INFURA_ID="..."
ETHERSCAN_API_KEY="..."
```

* Deployment to rinkeby is done via [Infura](https://infura.io/).
* Create an [Etherscan API key](https://etherscan.io/myapikey) for contract verification.

_Forks of this project should also modify `config.json`. Decimals aren't considered in the configuration._

## Deployment

### Ganache

[Ganache](https://www.trufflesuite.com/ganache) is a personal Ethereum blockchain for development and
tests.

```
npm run migrate -- --network development
```

### Rinkeby

To deploy on the [Rinkeby](https://rinkeby.io/) Ethereum testnet, make sure your wallet has enough ETH to pay for the
GAS.

[Faucet 1](https://testnet.help/en/ethfaucet/rinkeby) | [Faucet 2](https://faucet.rinkeby.io/)

```
npm run migrate -- --network rinkeby
npm run verify -- --network rinkeby
```

You may also want to verify the ERC20Mock and LPMock contracts on Etherscan.

```
node_modules/.bin/truffle verify ERC20Mock
node_modules/.bin/truffle verify LPMock
```

_Verification may fail because of rate limits. Just try again._

### Ethereum mainnet

```
npm run migrate -- --network mainnet
npm run verify -- --network mainnet
```

The account that is used to create the Staking contract should have a sufficient amount of (LTO) ERC20 to fund the
contract. Alternatively; to manually fund, remove the 'fund' property from the configuration.

# How it works

> **TODO: Staking is split into 2 contracts: `Deposit` and `Staking`. This isn't correctly documented yet in the README.**

The `Staking` contract will distribute ERC20 tokens to participants. This is a fixed amount relative to the number of
tokens deposited to the contract. These ERC20 tokens aren't minted. Instead, the contract needs to be funded.

The contract can be configured to accept multiple tokens as deposit.

## Creation

The following settings are specified in the constructor of the `Staking` contract

* the address of the ERC20 token
* the starting block
* the soft lock period (in blocks)

## Fund

The contract needs to be funded before the start block. 

To fund the contract, the `Staking` must be allowed to withdraw the amount of ERC20 using the `approve` method of the
ERC20 contract.

Call the `fund` method with the appropriate amount, and the desired end block.  It's possible to add funds with the staking contract
is running and increase the end block.

If the end block is reached, the staking contract is closed. It will no longer be possible to add funds. If the contract is
depleted, it will also be automatically closed (even before the specified end date). This prevents a bank run on the
contract to withdraw funds.

## Adding accepted ERC20 tokens 

Tokens are distributes amount users that has deposited specific ERC20 tokens. These tokens must be specified in the
contract using the `add` method.

It's possible to add accepted tokens at a later time.

### Reward per token deposited

The `add` method takes a `rewardAmount` and `rewardDivider` parameter. If the amount is `10` and the divider is `1000`,
the contract will pay out `10 / 1000 = 0.01` for every deposited token.

It's possible to change the reward at a later time via the `set` method.

## Capped deposit

It's possible to cap the deposit for a specific token using the `cap` method. This method takes 4 parameters;
`referenceToken`, `referenceAmount`, `cappedToken`, `cappedAmount`.

Example; if the reference amount is `10000` of token FOO, and the capped amount is `500000` of token BAR, then users
can deposit max `5 BAR` per `1 FOO`. 

## Deposit and withdraw

To participate in staking, users must deposit tokens using the `deposit` method.

Before using this method, the staking contract must be allowed to transfer the tokens. This is done via the `approve`
method on the token contract.

The current deposit can be check using the `deposited` method. 

Participants can withdraw their deposited tokens at any time using the `withdraw` method. However, withdrawing within
the soft lock period will slash part of the reward.

## Reward

Each participant has a pending reward which is hold by the staking contract. The pending reward can be checked using
the `pending` method.

When the deposited tokens are withdrawn, the contract will also pay out the reward.

### Soft lock

A soft lock period is specified when creating the contract. If a user withdraws during this period, the reward will be 
slashed.

The penalty is a percentage of the reward. This is 100% at the starting block and 0% when the soft lock ends. The
penalty is calculated with a linear formula.

The penalty will be burned.

# Frontend

The `frontend` folder contains the frontend application that allows users to participate.

_Note that the frontend is specifically styled and configured for VIDT. You need to modify it to use it for a
different project._  
