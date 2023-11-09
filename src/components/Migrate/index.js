const dir = require('node-dir');
const path = require('path');
const ResolverIntercept = require('./resolverintercept');
const Require = require('../Require');
const async = require('async');
const expect = require('@truffle/expect');
const Deployer = require('../Deployer');

const TronWrap = require('../TronWrap');
const Graph = require('./graph');
const logErrorAndExit = require('../TronWrap').logErrorAndExit;
let tronWrap;
// if the file is not prefixed with a number just assign -1 as the number
const not_prefixed = -1;

function Migration(file) {
  this.file = path.resolve(file);
  const num = parseInt(path.basename(file));
  if (isNaN(num)) this.number = not_prefixed;
  else this.number = num;
}

Migration.prototype.run = function (options, callback) {
  const self = this;
  const logger = options.logger;

  logger.log('Running migration: ' + path.relative(options.migrations_directory, this.file));

  const resolver = new ResolverIntercept(options.resolver);

  tronWrap = TronWrap(options);
  // Initial context.
  const context = {
    tronWrap: tronWrap
  };

  const deployer = new Deployer({
    options,
    logger: {
      log: function (msg) {
        logger.log('  ' + msg);
      }
    },
    network: options.network,
    network_id: options.network_id,
    provider: options.provider,
    basePath: path.dirname(this.file)
  });

  const finish = function (err, migrateFn) {
    if (err) return callback(err);
    deployer
      .start()
      .then(async function () {
        if (migrateFn && migrateFn.then !== undefined) {
          await migrateFn;
        }

        if (options.save === false) return;

        const Migrations = resolver.require('./Migrations.sol');

        if (Migrations && Migrations.isDeployed()) {
          logger.log('Saving successful migration to network...');

          await Migrations.deployed();
          const result = Migrations.call('setCompleted', [self.number]);

          return Promise.resolve(result);

          // return Migrations.deployed().then(function (migrations) {
          //   return Migrations.call('setCompleted', [self.number]);
          // });
        }
      })
      .then(function () {
        if (options.save === false) return;
        logger.log('Saving artifacts...');
        return options.artifactor.saveAll(resolver.contracts());
      })
      .then(function () {
        // Use process.nextTicK() to prevent errors thrown in the callback from triggering the below catch()
        process.nextTick(callback);
      })
      .catch(function (e) {
        logErrorAndExit(logger, e);
      });
  };
  const fn = Require.file(
    {
      file: self.file,
      context: context,
      resolver: resolver,
      args: [deployer]
    },
    options
  );

  if (!fn || !fn.length || fn.length === 0) {
    return callback(new Error('Migration ' + self.file + ' invalid or does not take any parameters'));
  }
  const migrateFn = fn(deployer, options.network, options.networks[options.network].from);
  finish(null, migrateFn);
};

const Migrate = {
  Migration: Migration,

  assemble: function (options, callback) {
    dir.files(options.migrations_directory, function (err, files) {
      if (err) return callback(err);

      options.allowed_extensions = options.allowed_extensions || /^\.(js|es6?)$/;

      files = files
        .filter(function (file) {
          return path.extname(file).match(options.allowed_extensions) != null;
        })
        .filter(function (file) {
          const baseName = path.basename(file);
          // allow files that starts with a number or an uppercase char
          return isNaN(parseInt(baseName)) === false || baseName.charAt(0).toUpperCase() === baseName.charAt(0);
        });

      let migrations = files.map(function (file) {
        return new Migration(file, options.network);
      });

      const graph = Graph.build(migrations);
      if (graph.length === 0) migrations = migrations.filter(({ number }) => number !== not_prefixed);
      else {
        process.stdout.write('migrations files have dependencies, performing topological sort\n');
        const sorted_files = Graph.toposort(files, graph);
        if (sorted_files.length !== migrations.length) {
          throw new Error('topological sort omitted some files, aborting...');
        }
        // let's reset the number to make them monotonically increasing
        // let's keep in mind that topolical sorting return leaf node at the end of the list
        // yet leaf nodes contract must be the first to deploy, since the graph represents dependencies
        // therefore we will reverse the ordering of the list
        const hashmap = new Map(); // useful for doing this in O(n)
        for (const migration of migrations) hashmap.set(migration.file, migration);
        for (let i = 0; i < sorted_files.length; i++) {
          const migration = hashmap.get(sorted_files[i]);
          if (typeof migration == undefined) {
            throw new Error('file path was altered while build graph or topological sort');
          }
          migration.number = sorted_files.length - i;
        }
      }

      // Make sure to sort the prefixes as numbers and not strings.
      migrations = migrations.sort(function (a, b) {
        if (a.number > b.number) {
          return 1;
        } else if (a.number < b.number) {
          return -1;
        }
        return 0;
      });

      callback(null, migrations);
    });
  },

  run: function (options, callback) {
    const self = this;

    expect.options(options, [
      'working_directory',
      'migrations_directory',
      'contracts_build_directory',
      'provider',
      'artifactor',
      'resolver',
      'network',
      'network_id',
      'logger',
      'from' // address doing deployment
    ]);

    if (options.reset === true) {
      return this.runAll(options, callback);
    }

    self.lastCompletedMigration(options, function (err, last_migration) {
      if (err) return callback(err);

      // Don't rerun the last completed migration.
      self.runFrom(last_migration + 1, options, callback);
    });
  },

  runFrom: function (number, options, callback) {
    const self = this;

    this.assemble(options, function (err, migrations) {
      if (err) return callback(err);

      while (migrations.length > 0) {
        if (migrations[0].number >= number) {
          break;
        }

        migrations.shift();
      }

      if (options.to) {
        migrations = migrations.filter(function (migration) {
          return migration.number <= options.to;
        });
      }

      self.runMigrations(migrations, options, callback);
    });
  },

  runAll: function (options, callback) {
    this.runFrom(0, options, callback);
  },

  runMigrations: function (migrations, options, callback) {
    // Perform a shallow clone of the options object
    // so that we can override the provider option without
    // changing the original options object passed in.
    const clone = {};

    Object.keys(options).forEach(function (key) {
      clone[key] = options[key];
    });

    if (options.quiet) {
      clone.logger = {
        log: function () {}
      };
    }

    clone.provider = this.wrapProvider(options.provider, clone.logger);
    clone.resolver = this.wrapResolver(options.resolver, clone.provider);

    async.eachSeries(
      migrations,
      function (migration, finished) {
        migration.run(clone, function (err) {
          if (err) return finished(err);
          finished();
        });
      },
      callback
    );
  },

  wrapProvider: function (provider, logger) {
    const printTransaction = function (tx_hash) {
      logger.log('  ... ' + tx_hash);
    };

    return {
      send: function (payload) {
        const result = provider.send(payload);

        if (payload.method === 'eth_sendTransaction') {
          printTransaction(result.result);
        }

        return result;
      },
      sendAsync: function (payload, callback) {
        provider.sendAsync(payload, function (err, result) {
          if (err) return callback(err);

          if (payload.method === 'eth_sendTransaction') {
            printTransaction(result.result);
          }

          callback(err, result);
        });
      }
    };
  },

  wrapResolver: function (resolver, provider) {
    return {
      require: function (import_path, search_path) {
        const abstraction = resolver.require(import_path, search_path);

        abstraction.setProvider(provider);

        return abstraction;
      },
      resolve: resolver.resolve
    };
  },

  lastCompletedMigration: function (options, callback) {
    // if called from console, tronWrap is null here
    // but the singleton has been initiated so:
    if (!tronWrap) {
      tronWrap = TronWrap();
    }

    const Migrations = options.resolver.require('Migrations');

    if (Migrations.isDeployed() === false) {
      return callback(null, 0);
    }

    Migrations.deployed()
      .then(function (migrations) {
        // Two possible Migrations.sol's (lintable/unlintable)

        return tronWrap.filterMatchFunction('last_completed_migration', migrations.abi)
          ? migrations.call('last_completed_migration')
          : migrations.call('lastCompletedMigration');
      })
      .then(function (completed_migration) {
        const value = typeof completed_migration === 'object' ? completed_migration : '0';
        callback(null, tronWrap._toNumber(value));
      })
      .catch(() => {
        // first migration:
        callback(null, 0);
      });
  },

  needsMigrating: function (options, callback) {
    const self = this;

    if (options.reset) {
      return callback(null, true);
    }

    this.lastCompletedMigration(options, function (err, number) {
      if (err) return callback(err);

      self.assemble(options, function (err, migrations) {
        if (err) return callback(err);

        while (migrations.length > 0) {
          if (migrations[0].number >= number) {
            break;
          }

          migrations.shift();
        }

        callback(null, migrations.length > 1);
      });
    });
  }
};

module.exports = Migrate;
