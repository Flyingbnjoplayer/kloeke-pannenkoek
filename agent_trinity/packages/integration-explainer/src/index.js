const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
      // ... rest of the knowledge base
    ]
  },
  'markdown best practices': {
    overview: 'Markdown best practices ensure consistent, readable documentation across all agents.',
    patterns: [
      {
        name: 'Header Structure',
        description: 'Use proper header hierarchy for document structure',
        useCase: 'All documentation files',
        pros: ['Consistent structure', 'Better readability'],
        cons: ['Requires planning']
      },
      {
        name: 'Code Formatting',
        description: 'Use proper code blocks and syntax highlighting',
        useCase: 'Code examples in documentation',
        pros: ['Clear code presentation', 'Syntax highlighting'],
        cons: ['Slightly more verbose']
      }
    ],
    implementation: {
      steps: [
        'Use markdownlint to validate all markdown files',
        'Fix common markdownlint issues automatically',
        'Follow markdownlint rules for consistency',
        'Use proper header hierarchy',
        'Format code blocks with language identifiers'
      ],
      security: [
        'Validate markdown to prevent injection',
        'Check for broken links',
        'Ensure consistent formatting',
        'Validate code examples',
        'Check for proper escaping'
      ]
    }
  }
};

// Main agent class
class IntegrationExplainer {
  constructor() {
    this.identity = identity;
    this.tools = tools;
    console.log('🤖 Agent 3 (Integration Explainer) initialized with markdownlint integration');
    console.log(`   Loaded ${Object.keys(this.tools.tools).length} tools`);
  }
  
  async validateMarkdown(filePath) {
    try {
      const result = execSync(`npx markdownlint "${filePath}"`, { encoding: 'utf-8' });
      console.log(`✅ ${filePath} passed markdownlint validation`);
      return { valid: true, errors: [] };
    } catch (error) {
      const errors = error.stdout.split('\n').filter(line => line.trim());
      console.log(`❌ ${filePath} has ${errors.length} markdownlint issues`);
      return { valid: false, errors };
    }
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
    
    // Save explanation to file and validate with markdownlint
    const explanationPath = path.join(__dirname, `../explanations/${topic.toLowerCase().replace(/\s+/g, '-')}.md`);
    fs.writeFileSync(explanationPath, explanation);
    
    const validation = await this.validateMarkdown(explanationPath);
    
    if (!validation.valid) {
      console.log("Attempting to fix markdownlint issues...");
      execSync(`npx markdownlint "${explanationPath}" --fix`, { encoding: 'utf-8' });
      return fs.readFileSync(explanationPath, 'utf-8');
    }
    
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
}

// Export singleton instance
const agent3 = new IntegrationExplainer();

// If running directly
if (require.main === module) {
  const topic = process.argv[2] || 'example-topic';
  agent3.explainIntegration(topic).then(console.log);
}

module.exports = { IntegrationExplainer, agent3 };
