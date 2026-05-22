const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class SkillMarkdownArchitect {
  constructor() {
    console.log("🤖 Agent 1 (SkillMarkdown Architect) initialized with markdownlint integration");
  }
  
  async validateMarkdown(filePath) {
    try {
      // Run markdownlint on the file
      const result = execSync(`npx markdownlint "${filePath}"`, { encoding: 'utf-8' });
      console.log(`✅ ${filePath} passed markdownlint validation`);
      return { valid: true, errors: [] };
    } catch (error) {
      // Parse errors from markdownlint output
      const errors = error.stdout.split('\n').filter(line => line.trim());
      console.log(`❌ ${filePath} has ${errors.length} markdownlint issues`);
      return { valid: false, errors };
    }
  }
  
  async fixMarkdown(filePath) {
    try {
      // Run markdownlint with --fix flag
      execSync(`npx markdownlint "${filePath}" --fix`, { encoding: 'utf-8' });
      console.log(`✅ Fixed markdownlint issues in ${filePath}`);
      return true;
    } catch (error) {
      console.log(`❌ Could not fix all markdownlint issues in ${filePath}`);
      return false;
    }
  }
  
  async createSkill(topic, context) {
    const skillContent = `# Skill: ${topic}\n\nThis is a skill created by the SkillMarkdown Architect.\n\nContext: ${context || 'None provided'}`;
    
    // Save skill to file
    const skillPath = path.join(__dirname, `../skills/${topic.toLowerCase().replace(/\s+/g, '-')}.md`);
    fs.writeFileSync(skillPath, skillContent);
    
    // Validate with markdownlint
    const validation = await this.validateMarkdown(skillPath);
    
    if (!validation.valid) {
      console.log("Attempting to fix markdownlint issues...");
      await this.fixMarkdown(skillPath);
    }
    
    return fs.readFileSync(skillPath, 'utf-8');
  }
}

const agent1 = new SkillMarkdownArchitect();

if (require.main === module) {
  const topic = process.argv[2] || 'example-skill';
  agent1.createSkill(topic).then(console.log);
}

module.exports = { SkillMarkdownArchitect, agent1 };
