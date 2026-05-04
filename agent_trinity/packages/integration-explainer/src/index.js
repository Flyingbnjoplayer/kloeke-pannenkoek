const fs = require('fs');
const path = require('path');

// Load identity file
const identityPath = path.join(__dirname, '../identity.md');
const identity = fs.existsSync(identityPath) ? fs.readFileSync(identityPath, 'utf-8') : '';

// Load tools configuration
const toolsPath = path.join(__dirname, '../tools/TOOLS.json');
const tools = fs.existsSync(toolsPath) ? JSON.parse(fs.readFileSync(toolsPath, 'utf-8')) : { tools: {} };

// Knowledge base for common integration topics
const knowledgeBase = {
  'API authentication': {
    overview: 'API authentication is the process of verifying the identity of a user or system trying to access API resources.',
    patterns: [
      {
        name: 'API Key Authentication',
        description: 'Simple method using a secret key sent with each request',
        useCase: 'Machine-to-machine communication',
        pros: ['Simple to implement', 'Stateless'],
        cons: ['Key can be compromised', 'No user context']
      },
      {
        name: 'OAuth 2.0',
        description: 'Authorization framework for delegated access',
        useCase: 'Third-party applications accessing user data',
        pros: ['Secure', 'Industry standard', 'User consent'],
        cons: ['Complex implementation', 'Multiple flows']
      },
      {
        name: 'JWT (JSON Web Tokens)',
        description: 'Self-contained tokens with user information',
        useCase: 'Stateless authentication in distributed systems',
        pros: ['Stateless', 'Contains user data', 'Standardized'],
        cons: ['Token size overhead', 'Revocation challenges']
      }
    ],
    implementation: {
      steps: [
        'Choose authentication method based on use case',
        'Implement server-side token generation/validation',
        'Add authentication middleware to protect endpoints',
        'Implement proper error handling for auth failures',
        'Add rate limiting to prevent abuse'
      ],
      security: [
        'Use HTTPS for all API communications',
        'Never store passwords in plain text',
        'Implement token expiration and refresh mechanisms',
        'Validate all inputs to prevent injection attacks',
        'Use secure storage for API keys and secrets'
      ]
    }
  },
  'database integration': {
    overview: 'Database integration involves connecting your application to a database for data storage and retrieval.',
    patterns: [
      {
        name: 'ORM (Object-Relational Mapping)',
        description: 'Map database tables to application objects',
        useCase: 'Complex applications with multiple entities',
        pros: ['Type safety', 'Reduced SQL', 'Database agnostic'],
        cons: ['Performance overhead', 'Learning curve']
      },
      {
        name: 'Query Builder',
        description: 'Programmatic SQL generation',
        useCase: 'Applications needing control over SQL',
        pros: ['SQL control', 'Prevents injection', 'Database agnostic'],
        cons: ['Still need SQL knowledge', 'Verbose for complex queries']
      },
      {
        name: 'Raw SQL',
        description: 'Direct SQL queries',
        useCase: 'Performance-critical applications',
        pros: ['Maximum performance', 'Full control'],
        cons: ['SQL injection risk', 'Database specific']
      }
    ],
    implementation: {
      steps: [
        'Choose database type (SQL vs NoSQL)',
        'Set up connection pooling',
        'Implement proper error handling',
        'Add database migrations',
        'Implement backup and recovery procedures'
      ],
      security: [
        'Use parameterized queries',
        'Implement proper access controls',
        'Encrypt sensitive data at rest',
        'Audit database access',
        'Regular security updates'
      ]
    }
  }
};

// Main agent class
class IntegrationExplainer {
  constructor() {
    this.identity = identity;
    this.tools = tools;
    console.log('🤖 Agent 3 (Integration Explainer) initialized');
    console.log(`   Loaded ${Object.keys(this.tools.tools).length} tools`);
  }
  
  // Main explanation method
  async explainIntegration(topic, context) {
    console.log(`📝 Explaining integration: ${topic}`);
    
    let explanation = `# Integration Explanation: ${topic}\n\n`;
    
    // Check if we have knowledge about this topic
    const topicLower = topic.toLowerCase();
    let foundKnowledge = false;
    
    for (const [key, knowledge] of Object.entries(knowledgeBase)) {
      if (topicLower.includes(key.toLowerCase())) {
        foundKnowledge = true;
        
        // Add overview
        explanation += `## Overview\n\n${knowledge.overview}\n\n`;
        
        // Add patterns
        explanation += `## Common Patterns\n\n`;
        knowledge.patterns.forEach(pattern => {
          explanation += `### ${pattern.name}\n\n`;
          explanation += `**Description**: ${pattern.description}\n\n`;
          explanation += `**Use Case**: ${pattern.useCase}\n\n`;
          explanation += `**Pros**: ${pattern.pros.join(', ')}\n\n`;
          explanation += `**Cons**: ${pattern.cons.join(', ')}\n\n`;
        });
        
        // Add implementation steps
        explanation += `## Implementation Steps\n\n`;
        knowledge.implementation.steps.forEach((step, index) => {
          explanation += `${index + 1}. ${step}\n`;
        });
        explanation += '\n';
        
        // Add security considerations
        explanation += `## Security Considerations\n\n`;
        knowledge.implementation.security.forEach((consideration, index) => {
          explanation += `${index + 1}. ${consideration}\n`;
        });
        explanation += '\n';
        
        break;
      }
    }
    
    // If no specific knowledge found, provide general guidance
    if (!foundKnowledge) {
      explanation += `I don't have specific information about "${topic}" yet. Here's some general guidance:\n\n`;
      explanation += `1. Research the specific requirements for ${topic}\n`;
      explanation += `2. Identify common patterns and best practices\n`;
      explanation += `3. Consider security implications from the start\n`;
      explanation += `4. Plan for scalability and maintenance\n`;
      explanation += `5. Implement proper error handling and monitoring\n\n`;
    }
    
    // Add information about available tools
    if (this.tools.tools && Object.keys(this.tools.tools).length > 0) {
      explanation += `## Available Tools\n\n`;
      explanation += `I can help you with these tools:\n\n`;
      Object.entries(this.tools.tools).forEach(([name, tool]) => {
        explanation += `- **${tool.name}**: ${tool.description}\n`;
        if (tool.capabilities) {
          explanation += `  - Capabilities: ${tool.capabilities.slice(0, 3).join(', ')}...\n`;
        }
      });
      explanation += '\n';
    }
    
    explanation += `## Next Steps\n\n`;
    explanation += `1. Would you like me to elaborate on any specific aspect?\n`;
    explanation += `2. Do you need help with implementation details?\n`;
    explanation += `3. Should we discuss security considerations in more depth?\n\n`;
    
    return explanation;
  }
  
  // Method to access tools
  getTools() {
    return this.tools;
  }
  
  // Method to get identity
  getIdentity() {
    return this.identity;
  }
  
  // Method to add knowledge
  addKnowledge(topic, knowledge) {
    knowledgeBase[topic.toLowerCase()] = knowledge;
  }
  
  // Method to list available topics
  listTopics() {
    return Object.keys(knowledgeBase);
  }
}

// Export singleton instance
const agent3 = new IntegrationExplainer();

// If running directly
if (require.main === module) {
  const topic = process.argv[2] || 'example-topic';
  agent3.explainIntegration(topic).then(console.log);
}

module.exports = { IntegrationExplainer, agent3 };
