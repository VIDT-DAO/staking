const ERC20 = artifacts.require("./ERC20Mock.sol");
const Deposits = artifacts.require("./Deposits.sol");
const Staking = artifacts.require("./Staking.sol");
const allConfigs = require("../config.json");

module.exports = function(deployer, network, addresses) {
  const config = allConfigs[network.replace(/-fork$/, '')] || allConfigs.default;

  if (!config) {
    return;
  }

  const erc20 = config.erc20;
  
  let deploy = deployer;
  
  if (!erc20.address) {
    deploy = deploy
      .then(() => {
        return deployer.deploy(
          ERC20,
          erc20.name,
          erc20.symbol,
          erc20.decimals,
          web3.utils.toBN(erc20.supply)
        );
      })
      .then(() => {return ERC20.deployed(); });
  }

  deploy = deploy  
    .then(() => {    
      return web3.eth.getBlockNumber();
    })
    .then((currentBlock) => {
      return deployer.deploy(
        Deposits
      );
    });

    return deploy;
};

