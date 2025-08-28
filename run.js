import * as fs from 'fs';
import Resolver from './src/resolver.js';

async function main() {
    const configPath = process.argv[2] ?? "./config.js";
    // JSON.parse(fs.readFileSync(configPath, 'utf8'))
    const config = (await import(configPath)).default

    const resolver = new Resolver(config);
    await resolver.initialize();
}

main().catch(error => {
    console.error('Resolver test failed:', error);
    process.exit(1);
});
