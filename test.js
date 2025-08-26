
const Resolver = require('./src/resolver');

async function testResolver() {
    console.log('Testing Resolver class...');
    
    const resolver = new Resolver();
    await resolver.initialize();
    
    // // 强制更新
    // const forceResolver = new Resolver({ forceUpdate: true });
    // await forceResolver.initialize();
}

// 运行测试
testResolver().catch(error => {
    console.error('Resolver test failed:', error);
    process.exit(1);
});
