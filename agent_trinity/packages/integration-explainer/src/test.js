const { agent3 } = require('./index');

async function runTests() {
  console.log('🧪 Running Agent 3 tests...\n');
  
  // Test 1: Basic explanation
  console.log('Test 1: Basic explanation');
  const explanation1 = await agent3.explainIntegration('API authentication');
  console.log('Result:', explanation1.substring(0, 100) + '...\n');
  
  // Test 2: Access tools
  console.log('Test 2: Access tools');
  const tools = agent3.getTools();
  console.log(`Available tools: ${Object.keys(tools.tools).length}\n`);
  
  // Test 3: Access identity
  console.log('Test 3: Access identity');
  const identity = agent3.getIdentity();
  console.log(`Identity loaded: ${identity.length} characters\n`);
  
  console.log('✅ All tests passed!');
}

runTests().catch(console.error);
