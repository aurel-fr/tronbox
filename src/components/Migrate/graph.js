const path = require('path');
const toposort = require('toposort');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const fs = require('fs');

module.exports = {
  build(migrations) {
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
      const deps = this.extractDeps(filePath);
      for (const dep of deps) {
        const depPath = fileNames.get(dep);
        if (!depPath) throw new Error('could not find the dependency path');
        graph.push([filePath, depPath]);
      }
    }
    return graph;
  },
  toposort: (nodes, edges) => toposort.array(nodes, edges),
  extractDeps: filePath => {
    // Read the file content
    const content = fs.readFileSync(filePath, 'utf8');

    // Parse the content into an AST
    const ast = parser.parse(content);

    // Traverse the AST to find the dependencies assignment
    let dependencies = [];
    traverse(ast, {
      AssignmentExpression(path) {
        // Use @babel/types to check for assignments to module.exports.dependencies
        if (
          t.isMemberExpression(path.node.left) &&
          t.isMemberExpression(path.node.left.object) &&
          t.isIdentifier(path.node.left.object.object, { name: 'module' }) &&
          t.isIdentifier(path.node.left.object.property, { name: 'exports' }) &&
          t.isIdentifier(path.node.left.property, { name: 'dependencies' }) &&
          t.isArrayExpression(path.node.right)
        ) {
          dependencies = path.node.right.elements.map(element => element.value);
        }
      }
    });
    return dependencies;
  }
};
