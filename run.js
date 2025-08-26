
const Resolver = require('./src/resolver');

async function main() {
    const resolver = new Resolver();
    await resolver.initialize();
}

main().catch(error => {
    console.error('Resolver test failed:', error);
    process.exit(1);
});
