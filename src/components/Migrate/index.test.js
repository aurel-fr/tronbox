const chai = require('chai');
const expect = chai.expect;

const Migrate = require('.');
const path = require('path');

describe('assemble function', function () {
  it('should sort migrations numerically if no dependencies are provided', function (done) {
    const options = {
      migrations_directory: path.resolve('test/fixtures/migrations'),
      allowed_extensions: /^\.(js)$/
    };
    const expected = [-1, 3, 5, 6, 7, 10];
    Migrate.assemble(options, (err, migrations) => {
      expect(err).to.be.null;
      expect(migrations).to.have.lengthOf(6);
      for (let i = 0; i < migrations.length; i++) {
        expect(migrations[i].number).to.equal(expected[i]);
      }
      done();
    });
  });

  it('should sort migrations using dependencies if they are provided', function (done) {
    const options = {
      migrations_directory: path.resolve('test/fixtures/migrations_with_deps'),
      allowed_extensions: /^\.(js)$/
    };
    const expected = [1, 2, 3, 4, 5, 6];
    Migrate.assemble(options, (err, migrations) => {
      expect(err).to.be.null;
      expect(migrations).to.have.lengthOf(6);
      const correct_order = ['3_Endpoint.js', 'NonceContract.js', '7_UltraLightNodeV2.js', '10_RelayerV2.js'];
      for (let i = 0; i < migrations.length; i++) {
        expect(migrations[i].number).to.equal(expected[i]);
        if (correct_order[0] === path.basename(migrations[i].file)) correct_order.shift();
      }
      expect(correct_order.length === 0);
      done();
    });
  });
});
