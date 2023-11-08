const path = require('path');
const toposort = require('toposort');

module.exports = {
  build: migrations => {
    const fileNames = new Map();
    for (const migration of migrations) {
      const fullPath = migration.file;
      let trimmed = path.basename(fullPath);
      const extension = path.extname(fullPath);
      trimmed = trimmed.slice(0, trimmed.length - extension.length); // remove the extension if it exists
      fileNames.set(trimmed, fullPath);
    }
    const graph = [];
    for (const migration of migrations) {
      const { file: filePath } = migration;
      let deployFunc;
      process.stdout.write('looking for dependency in ' + filePath + '\n');
      try {
        delete require.cache[filePath]; // ensure we reload it every time, so changes are taken in consideration
        deployFunc = require(filePath);
        for (const dep of deployFunc.dependencies || []) {
          const depPath = fileNames.get(dep);
          if (!depPath) throw new Error('could not find the dependency path');
          graph.push([filePath, depPath]);
        }
      } catch (e) {
        throw new Error('require failed:\n' + e);
      }
    }
    return graph;
  },
  toposort: (nodes, edges) => toposort.array(nodes, edges)
};
