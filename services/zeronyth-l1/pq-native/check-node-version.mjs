const major = Number(process.versions.node.split('.')[0]);
if (!Number.isInteger(major) || major < 24) {
  console.error(`ZERONYTH PQ lab requires Node.js >=24.0.0; current version is ${process.versions.node}. Install Node.js 24+ and rerun npm test.`);
  process.exit(1);
}
console.log(`Node.js ${process.versions.node} satisfies the PQ lab requirement.`);
