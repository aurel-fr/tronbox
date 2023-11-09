var Tuple = artifacts.require('./Tuple.sol');

module.exports.dependencies = ['Initial_migration'];
module.exports = function (deployer) {
  deployer.deploy(Tuple, ['Tom', '30'], { overwrite: true });
};
